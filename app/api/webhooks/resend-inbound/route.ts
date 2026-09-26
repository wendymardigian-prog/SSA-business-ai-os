/**
 * Receptor de los correos entrantes de Resend (F63).
 *
 * El tercer receptor del sistema, y sigue las mismas reglas que los otros
 * dos: firma validada antes de tocar nada, idempotencia por el id del
 * evento, 200 inmediato y procesamiento con `after()`.
 *
 * Lo que hace distinto, y es lo importante de este archivo: **no llama a
 * `maybeScheduleAgentTurn`**. El agente esta hecho para chat —contesta
 * corto y en el momento— y un email contestado asi se lee mal. Ademas
 * nadie lo pidio. Hay un test con espia que lo verifica, porque es la clase
 * de cosa que alguien agrega "por consistencia" sin darse cuenta.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { readSecret, SECRET_NAMES } from "@/lib/vault";
import { claimWebhookEvent, type ChannelRow } from "@/lib/inbound";
import { verifySvixSignature, REJECTION_REASONS } from "@/lib/email/svix";
import { findChannelByAddress, recipientAddress } from "@/lib/email/channel";
import { processInboundEmail, type InboundEmail } from "@/lib/email/inbound";
import { fetchReceivedEmail } from "@/lib/email/receiving";
import { runEmailTriggers } from "@/lib/email/triggers";

interface ResendEvent {
  type?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    subject?: string;
    created_at?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    return await handle(request);
  } catch (err) {
    console.error("[resend-inbound] error procesando el correo:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function handle(request: NextRequest) {
  const body = await request.text();

  let event: ResendEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  if (event.type !== "email.received") {
    return NextResponse.json({ ok: true, skipped: event.type ?? "sin tipo" });
  }

  const to = event.data?.to ?? [];
  const cc = event.data?.cc ?? [];
  if (to.length === 0) {
    return NextResponse.json({ ok: true, skipped: "sin destinatario" });
  }

  const supabase = await createServiceClient();

  // De que workspace es se sabe por la direccion a la que llego. Leer el
  // cuerpo antes de validar la firma no abre nada: lo unico que se hace
  // con el es buscar un canal, y sin firma valida no se procesa ni se
  // escribe nada.
  const { data: addresses } = await supabase
    .from("channels")
    .select("email_address")
    .eq("platform", "email")
    .eq("is_active", true);

  const target = recipientAddress({
    to,
    cc,
    knownAddresses: (addresses ?? [])
      .map((a) => a.email_address)
      .filter((a): a is string => Boolean(a)),
  });

  const channelRef = target ? await findChannelByAddress(supabase, target) : null;
  if (!channelRef) {
    // Un correo a una direccion que no es nuestra: se reconoce y se ignora.
    return NextResponse.json({ ok: true, skipped: "direccion desconocida" });
  }

  const secret = await readSecret(
    supabase,
    channelRef.workspaceId,
    SECRET_NAMES.resendInboundWebhookSecret,
  );
  if (!secret) {
    console.error("[resend-inbound] no hay secreto guardado; rechazo el correo");
    return NextResponse.json({ error: "Webhook sin secreto configurado" }, { status: 401 });
  }

  const verification = verifySvixSignature({
    secret,
    headers: {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    body,
  });

  if (!verification.ok) {
    // El motivo va al log, no a la respuesta: quien llama es publico.
    console.error(`[resend-inbound] rechazado: ${REJECTION_REASONS[verification.reason]}`);
    return NextResponse.json({ error: "Firma invalida" }, { status: 401 });
  }

  const eventId = request.headers.get("svix-id");
  if (!(await claimWebhookEvent(supabase, eventId ? `resend:${eventId}` : null))) {
    return NextResponse.json({ ok: true, skipped: "evento repetido" });
  }

  const emailId = event.data?.email_id;
  if (!emailId) {
    return NextResponse.json({ ok: true, skipped: "sin id de correo" });
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("*")
    .eq("id", channelRef.id)
    .maybeSingle();

  if (!channel) {
    return NextResponse.json({ ok: true, skipped: "canal desconocido" });
  }

  // 200 y despues se procesa: traer el contenido y copiar los adjuntos
  // puede tardar mas de lo que Resend espera.
  after(async () => {
    try {
      const full = await fetchReceivedEmail(supabase, {
        workspaceId: channelRef.workspaceId,
        emailId,
      });

      const email: InboundEmail = full ?? {
        // Sin el contenido completo se guarda lo que trajo el evento: es
        // menos, pero es mejor que perder el correo.
        emailId,
        from: event.data?.from ?? "",
        to,
        cc,
        subject: event.data?.subject ?? null,
        text: null,
        html: null,
        messageId: null,
        inReplyTo: null,
        references: null,
        receivedAt: event.data?.created_at ?? new Date().toISOString(),
      };

      const result = await processInboundEmail(supabase, {
        channel: channel as ChannelRow,
        email,
      });

      // Los flows corren despues de guardar, y nunca con un automatico.
      if (result.stored && !result.automatic && result.conversationId && result.contactId) {
        await runEmailTriggers(supabase, {
          channel: channel as ChannelRow,
          contactId: result.contactId,
          conversationId: result.conversationId,
          subject: email.subject,
          text: email.text ?? "",
        });
      }

      // Sin el asunto ni el cuerpo: el log no lleva el contenido.
      console.log(
        `[resend-inbound] ${emailId}: ${result.stored ? "guardado" : "no guardado"}` +
          `${result.automatic ? " (automatico)" : ""}${result.note ? ` — ${result.note}` : ""}`,
      );
    } catch (err) {
      console.error("[resend-inbound] error procesando el correo:", err);
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}
