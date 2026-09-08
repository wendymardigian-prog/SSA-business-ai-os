/**
 * Guardado de lo que entra por cualquier canal.
 *
 * Es la unica parte que corre en la Edge Function a proposito: esto es
 * almacenamiento, no logica de negocio. Decidir si responder solo, disparar un
 * flow o meter al agente de IA vive en el Next.js y se queda ahi.
 *
 * Como engancha la Fase 2: en vez de duplicar el motor de flows en Deno, estas
 * funciones van a encolar un job en scheduled_jobs (la tabla ya existe, y
 * /api/cron/jobs ya la procesa) y el Next.js lo consume. En Fase 1 todavia no
 * se encola nada porque no hay quien lo consuma: el mensaje se guarda y aparece
 * en la bandeja por Realtime, que es todo lo que esta fase necesita.
 */

import type { SupabaseClient } from "./db.ts";

/** Trunca el preview igual que lib/message-preview.ts en la app. */
export function messagePreview(text: string | null | undefined, max = 100): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * Reserva el id de un evento. false = ya lo procesamos antes (reintento del
 * proveedor), asi que hay que ignorarlo.
 *
 * Ante un error de base que no sea "clave duplicada" devuelve true: preferimos
 * arriesgar un duplicado antes que perder un mensaje.
 */
export async function claimEvent(
  supabase: SupabaseClient,
  eventId: string | null | undefined,
): Promise<boolean> {
  if (!eventId) return true;
  const { error } = await supabase.from("webhook_events").insert({ event_id: eventId });
  if (!error) return true;
  if (error.code === "23505") return false;
  console.error("[inbound] no pude reservar el evento:", error.message);
  return true;
}

export interface ChannelRow {
  id: string;
  workspace_id: string;
  platform: string;
  provider: string;
  evolution_instance: string | null;
  username: string | null;
}

export interface UpsertContactInput {
  supabase: SupabaseClient;
  channel: ChannelRow;
  /** Identificador del remitente en la plataforma: telefono para WhatsApp, id de Zernio para IG. */
  senderId: string;
  senderName: string;
  senderUsername?: string | null;
  senderPicture?: string | null;
  /** Telefono del lead cuando el canal lo trae (WhatsApp). Clave de deduplicacion cross-canal. */
  senderPhone?: string | null;
  /** Email del lead cuando el canal lo trae. */
  senderEmail?: string | null;
  interactionAt: string;
}

/**
 * Encuentra o crea el contacto detras de un remitente.
 *
 * Toda la decision vive en la funcion find_or_link_contact de la base
 * (migracion 00025): ademas del mapeo conocido en contact_channels, busca al
 * mismo lead por telefono, por email y por username de la misma plataforma,
 * y lo vincula en vez de duplicarlo. Esta de ese lado por dos motivos: es la
 * unica forma de compartir la logica entre esta Edge Function (Deno) y la app
 * (Node), y resuelve la carrera de dos canales escribiendo a la vez.
 */
export async function upsertContact({
  supabase,
  channel,
  senderId,
  senderName,
  senderUsername = null,
  senderPicture = null,
  senderPhone = null,
  senderEmail = null,
  interactionAt,
}: UpsertContactInput): Promise<{ contactId: string; existed: boolean } | null> {
  const { data, error } = await supabase.rpc("find_or_link_contact", {
    p_channel_id: channel.id,
    p_sender_id: senderId,
    p_display_name: senderName,
    p_username: senderUsername,
    p_avatar_url: senderPicture,
    p_phone: senderPhone,
    p_email: senderEmail,
    p_interaction_at: interactionAt,
    p_stamp_existing: true,
  });

  if (error || !data?.contact_id) {
    console.error("[inbound] no pude resolver el contacto:", error?.message);
    return null;
  }

  return { contactId: data.contact_id as string, existed: Boolean(data.existed) };
}

export interface UpsertConversationInput {
  supabase: SupabaseClient;
  channel: ChannelRow;
  contactId: string;
  /** Id de la conversacion en Zernio. Null para WhatsApp, que no tiene equivalente. */
  externalConversationId?: string | null;
  preview: string;
  at: string;
  /** Un mensaje que mandamos nosotros no suma no leidos. */
  incrementUnread: boolean;
}

export async function upsertConversation({
  supabase,
  channel,
  contactId,
  externalConversationId = null,
  preview,
  at,
  incrementUnread,
}: UpsertConversationInput): Promise<{ id: string; isAutomationPaused: boolean } | null> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id, is_automation_paused")
    .eq("channel_id", channel.id)
    .eq("contact_id", contactId)
    .maybeSingle();

  if (existing) {
    if (incrementUnread) {
      // increment_unread (migracion 00003) suma el no leido y pisa el preview
      // en una sola operacion, sin leer-y-escribir desde aca.
      await supabase.rpc("increment_unread", { conv_id: existing.id, preview });
    } else {
      await supabase
        .from("conversations")
        .update({ last_message_at: at, last_message_preview: preview, status: "open" })
        .eq("id", existing.id);
    }
    if (externalConversationId) {
      await supabase
        .from("conversations")
        .update({ late_conversation_id: externalConversationId })
        .eq("id", existing.id)
        .is("late_conversation_id", null);
    }
    return { id: existing.id, isAutomationPaused: existing.is_automation_paused };
  }

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      workspace_id: channel.workspace_id,
      channel_id: channel.id,
      contact_id: contactId,
      platform: channel.platform,
      late_conversation_id: externalConversationId,
      status: "open",
      last_message_at: at,
      last_message_preview: preview,
      unread_count: incrementUnread ? 1 : 0,
    })
    .select("id, is_automation_paused")
    .single();

  if (error || !created) {
    console.error("[inbound] no pude crear la conversacion:", error?.message);
    return null;
  }
  return { id: created.id, isAutomationPaused: created.is_automation_paused };
}

/**
 * Guarda el mensaje. Devuelve false si ya estaba (indice unico por
 * conversation_id + platform_message_id, migracion 00019).
 */
export async function insertMessage({
  supabase,
  conversationId,
  direction,
  text,
  platformMessageId,
  attachments = null,
  createdAt,
}: {
  supabase: SupabaseClient;
  conversationId: string;
  direction: "inbound" | "outbound";
  text: string | null;
  platformMessageId: string | null;
  attachments?: unknown;
  createdAt: string;
}): Promise<boolean> {
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    direction,
    text,
    platform_message_id: platformMessageId,
    attachments,
    status: "delivered",
    created_at: createdAt,
  });

  if (!error) return true;
  if (error.code === "23505") return false;
  console.error("[inbound] no pude guardar el mensaje:", error.message);
  return false;
}
