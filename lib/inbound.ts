/**
 * Lo que hacen en comun los receptores de webhooks de canales.
 *
 * Hay uno por proveedor porque los payloads no se parecen en nada
 * (app/api/webhooks/late para Zernio, app/api/webhooks/evolution para WhatsApp),
 * pero lo que pasa despues de entender el mensaje es identico: resolver el
 * contacto, actualizar la conversacion, guardar el mensaje, mirar si el lead
 * pidio que no le escriban mas y recien ahi evaluar automatizaciones.
 *
 * Las decisiones que tienen que valer igual para todos los canales viven en la
 * base, no aca: find_or_link_contact (migracion 00025) para la deduplicacion
 * cross-canal y apply_opt_out_check (00027) para el "no contactar". Este modulo
 * las llama, no las reimplementa.
 */

import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { executeFlow } from "@/lib/flow-engine/engine";
import { matchTrigger } from "@/lib/flow-engine/trigger-matcher";
import type { IncomingMessage } from "@/lib/flow-engine/types";

type Db = SupabaseClient<Database>;

export type ChannelRow = Database["public"]["Tables"]["channels"]["Row"];

/**
 * Compara dos strings en tiempo constante.
 *
 * Para el token del webhook de Evolution: con `===` el tiempo de comparacion
 * depende de cuantos caracteres coinciden, y eso alcanza para adivinarlo de a
 * un byte. La diferencia de largo si se filtra, pero eso no ayuda a adivinar el
 * contenido.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Reserva el id de un evento antes de procesarlo.
 *
 * `false` significa que otra entrega del mismo evento ya lo reclamo: los
 * proveedores reintentan con el mismo id cuando nuestro 200 no llega a tiempo,
 * y sin esto un reintento volveria a disparar el flow (llegaron a salir DMs
 * duplicados por eso). Un evento sin id se procesa igual, no se descarta.
 *
 * Ante un error de base que no sea "clave duplicada" devuelve true: preferimos
 * arriesgar un duplicado antes que perder un mensaje del lead.
 */
export async function claimWebhookEvent(
  supabase: Db,
  eventId: string | null | undefined,
): Promise<boolean> {
  if (!eventId) return true;

  const { error } = await supabase.from("webhook_events").insert({ event_id: eventId });
  if (!error) return true;
  if (error.code === "23505") return false;

  console.error("[inbound] no pude reservar el evento:", error.message);
  return true;
}

export interface UpsertConversationInput {
  supabase: Db;
  channel: Pick<ChannelRow, "id" | "workspace_id" | "platform">;
  contactId: string;
  /** Id de la conversacion en Zernio. Null para WhatsApp, que no tiene equivalente. */
  externalConversationId?: string | null;
  preview: string;
  at: string;
  /** Un mensaje que mandamos nosotros no suma no leidos. */
  incrementUnread: boolean;
}

/**
 * Encuentra o crea la conversacion de este contacto en este canal.
 *
 * Cada canal conserva SU conversacion: la clave es (channel_id, contact_id), asi
 * que un mismo lead que escribe por Instagram y por WhatsApp tiene un solo
 * contacto y dos hilos separados.
 */
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
      // increment_unread (migracion 00003) suma el no leido, pisa el preview y
      // reabre la conversacion en una sola operacion, sin leer y volver a
      // escribir desde aca.
      await supabase.rpc("increment_unread", { conv_id: existing.id, preview });
    } else {
      await supabase
        .from("conversations")
        .update({ last_message_at: at, last_message_preview: preview, status: "open" })
        .eq("id", existing.id);
    }

    // Se completa solo si estaba vacio: el id de Zernio no cambia, y pisarlo
    // con el de otra entrega romperia la lectura del hilo.
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
 * Guarda el mensaje en la tabla local.
 *
 * Solo lo usan los canales que no tienen donde mas vivir: los de Zernio los
 * guarda Zernio, que es la fuente de verdad, y la app le pide el hilo por API.
 *
 * Devuelve false si el mensaje ya estaba, por el indice unico
 * (conversation_id, platform_message_id) de la migracion 00019. Eso es lo que
 * evita duplicar el eco de un mensaje que ya guardamos al enviarlo.
 */
export async function insertMessage({
  supabase,
  conversationId,
  direction,
  text,
  platformMessageId,
  attachments = null,
  createdAt,
  sentByUserId = null,
}: {
  supabase: Db;
  conversationId: string;
  direction: "inbound" | "outbound";
  text: string | null;
  platformMessageId: string | null;
  attachments?: unknown;
  createdAt: string;
  sentByUserId?: string | null;
}): Promise<boolean> {
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    direction,
    text,
    platform_message_id: platformMessageId,
    attachments: attachments as never,
    sent_by_user_id: sentByUserId,
    status: "delivered",
    created_at: createdAt,
  });

  if (!error) return true;
  if (error.code === "23505") return false;

  console.error("[inbound] no pude guardar el mensaje:", error.message);
  return false;
}

/**
 * Frena las secuencias del contacto en ese canal porque contesto (F11).
 *
 * Esto no existia: una secuencia solo se paraba si el lead escribia una frase
 * de baja ("stop", "no me contactes") o si estaba marcado "no contactar". Si
 * contestaba "gracias, lo veo manana", el seguimiento le seguia mandando pasos
 * como si nada — que es exactamente lo contrario de lo que un seguimiento
 * automatico tiene que hacer.
 *
 * La pausa y su entrada en el audit log viven en pause_sequences_on_reply
 * (migracion 00044) para que pasen juntas, en una transaccion, sin importar
 * cual de los dos receptores recibio el mensaje.
 *
 * Se limita al canal del mensaje: un lead que contesta por Instagram no tiene
 * por que frenar el seguimiento que corre por WhatsApp.
 *
 * Nunca lanza: que una pausa falle no puede tumbar la recepcion de un mensaje
 * que ya quedo guardado.
 */
export async function pauseSequencesOnReply({
  supabase,
  contactId,
  channelId,
}: {
  supabase: Db;
  contactId: string;
  channelId: string;
}): Promise<{ paused: number }> {
  const { data, error } = await supabase.rpc("pause_sequences_on_reply", {
    p_contact_id: contactId,
    p_channel_id: channelId,
  });

  if (error) {
    console.error("[inbound] no pude pausar las secuencias:", error.message);
    return { paused: 0 };
  }

  const paused = typeof data === "number" ? data : 0;
  if (paused > 0) {
    console.log(`[inbound] ${paused} secuencia(s) pausadas porque el contacto respondio`);
  }
  return { paused };
}

/**
 * Marca "no contactar" si el mensaje entrante trae una frase de baja.
 *
 * La lista de frases y el marcado viven en apply_opt_out_check (migracion
 * 00027): son configurables por workspace y la regla no puede depender de por
 * que canal escribio el lead.
 *
 * Devuelve `matched: true` cuando quedo marcado. Quien llama tiene que cortar
 * ahi: alguien que acaba de pedir que no le escriban mas no puede recibir una
 * respuesta automatica.
 */
export async function applyOptOut({
  supabase,
  contactId,
  conversationId = null,
  text,
}: {
  supabase: Db;
  contactId: string;
  conversationId?: string | null;
  text: string | null;
}): Promise<{ matched: boolean; phrase: string | null }> {
  if (!text) return { matched: false, phrase: null };

  const { data, error } = await supabase.rpc("apply_opt_out_check", {
    p_contact_id: contactId,
    p_conversation_id: conversationId,
    p_text: text,
  });

  if (error) {
    console.error("[inbound] no pude evaluar el opt-out:", error.message);
    return { matched: false, phrase: null };
  }

  const result = data as { matched?: boolean; phrase?: string } | null;
  if (result?.matched) {
    console.log(`[inbound] contacto marcado como no contactar por "${result.phrase}"`);
  }

  return { matched: Boolean(result?.matched), phrase: result?.phrase ?? null };
}

/**
 * El mensaje entrante, tal como lo entiende el motor.
 *
 * Se re-exporta el del flow-engine en vez de mantener una copia: eran dos
 * definiciones identicas que ya se habian empezado a separar (la marca de
 * respuesta a historia que suma F6 estaba en una y no en la otra).
 */
export type { IncomingMessage };

/**
 * Palabras clave globales del workspace (suscribir / desuscribir).
 *
 * Devuelve true cuando la palabra se consumio: en ese caso no se evalua ningun
 * trigger, para que un "STOP" no dispare ademas un flow de bienvenida.
 */
export async function handleGlobalKeywords(
  supabase: Db,
  workspaceId: string,
  contactId: string,
  text: string | undefined,
): Promise<boolean> {
  if (!text) return false;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("global_keywords")
    .eq("id", workspaceId)
    .single();

  if (!workspace?.global_keywords) return false;

  const keywords = workspace.global_keywords as Array<{
    keyword: string;
    action?: string;
    flowId?: string;
  }>;

  const normalizedText = text.toLowerCase().trim();

  for (const kw of keywords) {
    if (normalizedText === kw.keyword.toLowerCase()) {
      if (kw.action === "unsubscribe") {
        await supabase.from("contacts").update({ is_subscribed: false }).eq("id", contactId);
        return true;
      }
      if (kw.action === "subscribe") {
        await supabase.from("contacts").update({ is_subscribed: true }).eq("id", contactId);
        return true;
      }
      return false;
    }
  }

  return false;
}

/**
 * Evalua automatizaciones para un mensaje entrante: palabras clave globales
 * primero, despues los triggers de flow.
 *
 * Esto es lo que la Edge Function no podia hacer y por lo que la recepcion
 * volvio a la app: el motor de flows vive en Node y no se puede llamar desde
 * Deno. Un mensaje que entraba por ahi quedaba guardado pero no automatizaba
 * nada.
 *
 * Nunca lanza: una automatizacion que falla no puede tumbar la recepcion del
 * mensaje, que ya quedo guardado.
 */
export async function runInboundAutomation({
  supabase,
  channel,
  contactId,
  conversationId,
  isAutomationPaused,
  isFirstMessage,
  incomingMessage,
  lateConversationId,
  lateAccountId,
}: {
  supabase: Db;
  channel: Pick<ChannelRow, "id" | "workspace_id">;
  contactId: string;
  conversationId: string;
  isAutomationPaused: boolean;
  isFirstMessage: boolean;
  incomingMessage: IncomingMessage;
  lateConversationId?: string | null;
  lateAccountId?: string | null;
}): Promise<void> {
  // Alguien tomo la conversacion a mano: el bot no se mete.
  if (isAutomationPaused) return;

  const handled = await handleGlobalKeywords(
    supabase,
    channel.workspace_id,
    contactId,
    incomingMessage.text,
  );
  if (handled) return;

  const trigger = await matchTrigger(supabase, {
    channelId: channel.id,
    workspaceId: channel.workspace_id,
    conversationId,
    message: incomingMessage,
    isFirstMessage,
  });
  if (!trigger) return;

  try {
    await executeFlow(supabase, {
      triggerId: trigger.id,
      flowId: trigger.flow_id,
      channelId: channel.id,
      contactId,
      conversationId,
      workspaceId: channel.workspace_id,
      incomingMessage,
      lateConversationId: lateConversationId ?? undefined,
      lateAccountId: lateAccountId ?? undefined,
    });
  } catch (err) {
    console.error("[inbound] error ejecutando el flow:", err);
  }
}
