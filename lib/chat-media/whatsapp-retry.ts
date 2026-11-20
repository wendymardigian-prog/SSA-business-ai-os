/**
 * Volver a pedirle a Evolution el archivo de un mensaje de WhatsApp que fallo.
 *
 * A diferencia de Instagram, WhatsApp no deja una URL para volver a bajar: el
 * archivo esta cifrado y solo Evolution lo puede abrir. Para reintentar se le
 * pide por el id del mensaje (`platform_message_id`) y Evolution lo busca en su
 * propia base. Si ya no lo tiene (o WhatsApp borro el archivo), el item queda
 * con «WhatsApp ya no tiene este archivo» y sin boton.
 *
 * Lo usan el boton «Reintentar» de la bandeja y la cola (`whatsapp_media_retry`,
 * para recuperar lo que fallo por el bug del 400). Solo baja el archivo y lo
 * transcribe o describe: no dispara automatizaciones ni el agente.
 *
 * Siempre con el cliente de servicio: quien llama ya comprobo que la persona
 * ve el mensaje (o es la cola). Nunca lanza.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { parseAttachments, type ChatAttachment } from "@/lib/messages/attachments";
import { storeInboundMedia, type MediaFetcher } from "@/lib/inbound-media";
import { evolutionMediaFetcher } from "@/lib/evolution-media";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { afterMediaStored } from "@/lib/chat-media/after-stored";

type Db = SupabaseClient<Database>;

/** Que paso con el reintento. */
export type WhatsappMediaRetryResult =
  /** Se volvio a pedir: `stored` cuantos se guardaron, `failed` cuantos no. */
  | { kind: "retried"; stored: number; failed: number }
  /** No habia nada para reintentar, o el mensaje no es de WhatsApp: no se toco nada. */
  | { kind: "skipped"; reason: "not_found" | "not_whatsapp" | "nothing_to_retry" | "no_message_id" | "no_config" };

/** Los adjuntos que se pueden volver a pedir: fallidos y sin URL propia (esos son de Instagram). */
export function whatsappRetryableItems(items: ChatAttachment[]): ChatAttachment[] {
  return items.map((item) =>
    item.status === "failed" && !item.sourceUrl && !item.storagePath
      ? { ...item, status: "pending" as const, error: null }
      : item,
  );
}

/** El mensaje y su canal, para saber si es de WhatsApp y a que instancia pedirle. */
export async function loadWhatsappMessage(
  service: Db,
  messageId: string,
): Promise<
  | {
      id: string;
      workspaceId: string;
      conversationId: string;
      platformMessageId: string | null;
      attachments: unknown;
      instance: string | null;
      isWhatsapp: boolean;
    }
  | null
> {
  const { data: message } = await service
    .from("messages")
    .select("id, workspace_id, conversation_id, platform_message_id, attachments")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return null;

  const { data: conversation } = await service
    .from("conversations")
    .select("channel_id")
    .eq("id", message.conversation_id)
    .maybeSingle();
  const { data: channel } = conversation?.channel_id
    ? await service.from("channels").select("platform, evolution_instance").eq("id", conversation.channel_id).maybeSingle()
    : { data: null };

  return {
    id: message.id,
    workspaceId: message.workspace_id,
    conversationId: message.conversation_id,
    platformMessageId: message.platform_message_id,
    attachments: message.attachments,
    instance: channel?.evolution_instance ?? null,
    isWhatsapp: channel?.platform === "whatsapp",
  };
}

export async function retryWhatsappMedia(args: {
  service: Db;
  messageId: string;
  /** Solo para tests: reemplaza a Evolution. */
  fetcher?: MediaFetcher;
}): Promise<WhatsappMediaRetryResult> {
  try {
    const message = await loadWhatsappMessage(args.service, args.messageId);
    if (!message) return { kind: "skipped", reason: "not_found" };
    if (!message.isWhatsapp) return { kind: "skipped", reason: "not_whatsapp" };

    const items = whatsappRetryableItems(parseAttachments(message.attachments));
    if (!items.some((item) => item.status === "pending")) return { kind: "skipped", reason: "nothing_to_retry" };
    if (!message.platformMessageId) return { kind: "skipped", reason: "no_message_id" };

    let fetcher = args.fetcher;
    if (!fetcher) {
      const config = await getEvolutionConfig(args.service, message.workspaceId);
      if (!config || !message.instance) return { kind: "skipped", reason: "no_config" };
      fetcher = evolutionMediaFetcher({ config, instance: message.instance, messageKeyId: message.platformMessageId });
    }

    const stored = await storeInboundMedia({
      supabase: args.service,
      workspaceId: message.workspaceId,
      conversationId: message.conversationId,
      messageId: message.id,
      items,
      fetcher,
    });
    await afterMediaStored({ supabase: args.service, messageId: message.id, items: stored.items });
    return { kind: "retried", stored: stored.stored, failed: stored.failed };
  } catch (err) {
    console.error("[whatsapp-retry] fallo el reintento:", err instanceof Error ? err.message : "desconocido");
    return { kind: "retried", stored: 0, failed: 0 };
  }
}
