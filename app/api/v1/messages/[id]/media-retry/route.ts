/**
 * Reintentar la descarga de un adjunto que fallo (F12).
 *
 * Dos caminos, con rama explicita por canal:
 * - Instagram guarda la URL del proveedor (`sourceUrl`) y se vuelve a bajar de ahi.
 * - WhatsApp no tiene URL: se le pide a Evolution por el id del mensaje
 *   (`retryWhatsappMedia`). Si ya no lo tiene, queda «ya no tiene este archivo».
 *
 * Misma autorizacion que el reintento de transcripcion: se lee con el cliente
 * del USUARIO (la RLS decide) y se baja con service role.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { parseAttachments } from "@/lib/messages/attachments";
import { storeInboundMedia } from "@/lib/inbound-media";
import { afterMediaStored } from "@/lib/chat-media/after-stored";
import { loadWhatsappMessage, retryWhatsappMedia, whatsappRetryableItems } from "@/lib/chat-media/whatsapp-retry";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "Falta el mensaje" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: message } = await supabase
    .from("messages")
    .select("id, workspace_id, conversation_id, direction, attachments")
    .eq("id", id)
    .maybeSingle();

  if (!message) return NextResponse.json({ error: "No encontre ese mensaje" }, { status: 404 });
  // Solo lo que llego del proveedor: la direccion de un mensaje saliente la pudo escribir cualquiera (00311).
  if (message.direction !== "inbound") {
    return NextResponse.json({ error: "Este adjunto no se puede volver a bajar" }, { status: 409 });
  }

  const service = await createServiceClient();

  // WhatsApp: se le pide a Evolution por el id del mensaje. La persona ya probo
  // que lo ve (la lectura de arriba va con su sesion).
  const whatsapp = await loadWhatsappMessage(service, id);
  if (whatsapp?.isWhatsapp) {
    const retryable = whatsappRetryableItems(parseAttachments(message.attachments));
    if (!retryable.some((item) => item.status === "pending")) {
      return NextResponse.json({ error: "Este adjunto no se puede volver a bajar" }, { status: 409 });
    }
    after(async () => {
      await retryWhatsappMedia({ service, messageId: id });
    });
    return NextResponse.json({ ok: true, status: "queued" });
  }

  // Los que fallaron y todavia tienen de donde bajarse. Vuelven a `pending`, que
  // es lo que muestra "Descargando adjunto…" en la burbuja.
  const items = parseAttachments(message.attachments).map((item) =>
    item.status === "failed" && item.sourceUrl ? { ...item, status: "pending" as const, error: null } : item,
  );

  if (!items.some((item) => item.status === "pending")) {
    return NextResponse.json(
      { error: "Este adjunto no se puede volver a bajar: el proveedor ya no lo tiene" },
      { status: 409 },
    );
  }

  // Se responde antes de bajar: el que apreto el boton no tiene que esperar el
  // archivo, la burbuja ya muestra el spinner y realtime la actualiza.
  after(async () => {
    try {
      const stored = await storeInboundMedia({
        supabase: service,
        workspaceId: message.workspace_id,
        conversationId: message.conversation_id,
        messageId: id,
        items,
      });
      await afterMediaStored({ supabase: service, messageId: id, items: stored.items });
    } catch (err) {
      console.error("[media-retry] fallo el reintento:", err instanceof Error ? err.message : "desconocido");
    }
  });

  return NextResponse.json({ ok: true, status: "queued" });
}
