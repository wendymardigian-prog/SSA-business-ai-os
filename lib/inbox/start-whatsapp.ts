/**
 * Abrir el chat de WhatsApp de un contacto en un número del negocio, aunque
 * nunca haya escrito. Lo usan el envío en tanda (broadcasts) y el botón del
 * teléfono en Agenda.
 *
 * Si el contacto todavía no está vinculado a ese número, primero se pregunta a
 * Evolution si su teléfono tiene WhatsApp: sin WhatsApp no se deja vínculo ni
 * conversación. Con WhatsApp se lo vincula (`contact_channels`, con el número en
 * la forma que usa WhatsApp, así su respuesta cae en el mismo chat) y se abre
 * la conversación. No manda ningún mensaje.
 *
 * Va con el cliente de SERVICIO: quien la llama ya decidió que se puede.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { upsertConversation } from "@/lib/inbound";
import { resolveWhatsappTarget } from "@/lib/send-queue/whatsapp-number";

type Client = SupabaseClient<Database>;

export type EnsureWhatsappChatResult =
  | { ok: true; conversationId: string }
  /**
   * no_phone: no hay teléfono. no_whatsapp: ese número no tiene WhatsApp. not_configured: Evolution no está configurado.
   * phone_in_use: ese número ya está vinculado a otro contacto en este WhatsApp. error: algo falló (se puede reintentar).
   */
  | { ok: false; reason: "no_phone" | "no_whatsapp" | "not_configured" | "phone_in_use" | "error"; message: string };

export async function ensureWhatsappChat(
  service: Client,
  input: { workspaceId: string; channel: { id: string; evolutionInstance: string | null }; contactId: string; phone: string | null; preview: string },
): Promise<EnsureWhatsappChatResult> {
  const { data: link } = await service
    .from("contact_channels")
    .select("contact_id")
    .eq("channel_id", input.channel.id)
    .eq("contact_id", input.contactId)
    .limit(1)
    .maybeSingle();

  if (!link) {
    if (!input.phone) return { ok: false, reason: "no_phone", message: "Este contacto no tiene teléfono." };
    const resolved = await resolveWhatsappTarget(service, input.workspaceId, input.channel.evolutionInstance, input.phone);
    if (resolved.kind === "no_whatsapp") return { ok: false, reason: "no_whatsapp", message: "Ese número no tiene WhatsApp." };
    if (resolved.kind === "not_configured") return { ok: false, reason: "not_configured", message: "WhatsApp no está configurado en este entorno." };
    if (resolved.kind === "error") return { ok: false, reason: "error", message: "No pude comprobar si el número tiene WhatsApp." };
    const { error } = await service.from("contact_channels").insert({ contact_id: input.contactId, channel_id: input.channel.id, platform_sender_id: resolved.target });
    if (error) {
      if (error.code === "23505") return { ok: false, reason: "phone_in_use", message: "Ese número ya está vinculado a otro contacto en este WhatsApp." };
      return { ok: false, reason: "error", message: "No pude vincular el contacto al número." };
    }
  }

  const { data: conv } = await service.from("conversations").select("id").eq("channel_id", input.channel.id).eq("contact_id", input.contactId).maybeSingle();
  if (conv) return { ok: true, conversationId: conv.id };
  const created = await upsertConversation({
    supabase: service,
    channel: { id: input.channel.id, workspace_id: input.workspaceId, platform: "whatsapp" },
    contactId: input.contactId,
    preview: input.preview,
    at: new Date().toISOString(),
    incrementUnread: false,
  });
  return created ? { ok: true, conversationId: created.id } : { ok: false, reason: "error", message: "No pude abrir la conversación." };
}
