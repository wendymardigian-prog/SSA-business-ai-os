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
  interactionAt: string;
}

/**
 * Encuentra o crea el contacto detras de un remitente, reusando el mapeo de
 * contact_channels. Misma semantica que upsertContactForSender en
 * lib/inbox-sync.ts, para que un contacto creado por el webhook y uno creado
 * por el backfill de la app sean el mismo.
 */
export async function upsertContact({
  supabase,
  channel,
  senderId,
  senderName,
  senderUsername = null,
  senderPicture = null,
  interactionAt,
}: UpsertContactInput): Promise<{ contactId: string; existed: boolean } | null> {
  const { data: link } = await supabase
    .from("contact_channels")
    .select("contact_id")
    .eq("channel_id", channel.id)
    .eq("platform_sender_id", senderId)
    .maybeSingle();

  if (link) {
    await supabase
      .from("contacts")
      .update({ last_interaction_at: interactionAt })
      .eq("id", link.contact_id);
    return { contactId: link.contact_id, existed: true };
  }

  const { data: contact, error } = await supabase
    .from("contacts")
    .insert({
      workspace_id: channel.workspace_id,
      display_name: senderName,
      avatar_url: senderPicture,
      last_interaction_at: interactionAt,
    })
    .select("id")
    .single();

  if (error || !contact) {
    console.error("[inbound] no pude crear el contacto:", error?.message);
    return null;
  }

  await supabase.from("contact_channels").insert({
    contact_id: contact.id,
    channel_id: channel.id,
    platform_sender_id: senderId,
    platform_username: senderUsername,
  });

  await supabase.from("analytics_events").insert({
    workspace_id: channel.workspace_id,
    contact_id: contact.id,
    event_type: "contact_created",
  });

  return { contactId: contact.id, existed: false };
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
