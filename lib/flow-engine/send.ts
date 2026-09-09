import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import { getEvolutionConfig, sendText, EvolutionError } from "@/lib/evolution-client";
import { describeSendError, RATE_LIMIT_REACHED, type FriendlyError } from "@/lib/instagram-errors";

/**
 * La unica puerta de salida del motor de flows.
 *
 * Antes cada nodo armaba su propio cliente de Zernio y mandaba. Eso tenia dos
 * problemas: los flows sobre un canal de WhatsApp cortaban en silencio (el
 * motor solo sabia hablar Zernio, y el adaptador de plataforma adaptaba el
 * formato de un mensaje que despues salia por el transporte equivocado), y no
 * habia ningun lugar donde poner el tope de envios ni la traduccion de errores.
 *
 * Ahora hay uno solo, y ramifica por `channels.provider`. Lo de WhatsApp queda
 * escrito y listo; se prueba en vivo cuando se conecte el numero.
 */

/** Tope de mensajes automatizados por hora que impone Instagram. */
const INSTAGRAM_HOURLY_LIMIT = 200;

/**
 * Lo minimo que hace falta para mandar un mensaje y dejarlo registrado.
 *
 * Antes esto pedia un FlowExecutionContext entero, que ademas de estos campos
 * exige triggerId, incomingMessage y un flowId que existe en la tabla `flows`.
 * Las secuencias no tienen nada de eso: corren por cron, sin trigger y sin
 * sesion. Inventar un contexto falso no alcanzaba porque messages.sent_by_flow_id
 * tiene FK a flows, asi que un uuid inventado rompia el insert.
 *
 * Un FlowExecutionContext es estructuralmente un SendContext, asi que el motor
 * sigue llamando igual que antes.
 */
export interface SendContext {
  workspaceId: string;
  channelId: string;
  contactId: string;
  conversationId: string;
  /** Id de la conversacion en Zernio, si ya se conoce. Se resuelve solo si falta. */
  lateConversationId?: string;
  /** Id de la cuenta en Zernio, si ya se conoce. Sale del canal si falta. */
  lateAccountId?: string;
  /** null cuando el envio no nace de un flow (secuencias, envios manuales). */
  flowId?: string | null;
}

export interface OutboundMessage {
  text: string;
  mediaUrl?: string;
  mediaType?: string;
  buttons?: unknown[];
  quickReplies?: unknown[];
  template?: unknown;
  replyMarkup?: unknown;
}

export interface SendOutcome {
  ok: boolean;
  platformMessageId?: string | null;
  /** Solo si ok es false. Ya viene traducido para mostrarle a una persona. */
  failure?: FriendlyError;
}

interface ChannelRow {
  id: string;
  provider: string;
  platform: string;
  late_account_id: string | null;
  evolution_instance: string | null;
  workspace_id: string;
}

/**
 * Manda un mensaje por el canal de la conversacion.
 *
 * Reclama primero un lugar en la ventana horaria: si el canal ya llego al tope,
 * ni se intenta el envio. Es preferible frenar nosotros a que Instagram empiece
 * a rechazar y termine limitando la cuenta.
 */
export async function sendChannelMessage(
  supabase: SupabaseClient<Database>,
  context: SendContext,
  message: OutboundMessage
): Promise<SendOutcome> {
  const channel = await loadChannel(supabase, context.channelId);
  if (!channel) {
    return {
      ok: false,
      failure: {
        kind: "unknown",
        message: "No se encontro el canal de la conversacion.",
        retryable: false,
      },
    };
  }

  const allowed = await claimSend(supabase, channel);
  if (!allowed) {
    return { ok: false, failure: RATE_LIMIT_REACHED };
  }

  if (channel.provider === "evolution") {
    return sendViaEvolution(supabase, context, channel, message);
  }
  return sendViaZernio(supabase, context, channel, message);
}

async function loadChannel(
  supabase: SupabaseClient<Database>,
  channelId: string
): Promise<ChannelRow | null> {
  const { data } = await supabase
    .from("channels")
    .select("id, provider, platform, late_account_id, evolution_instance, workspace_id")
    .eq("id", channelId)
    .single();
  return (data as ChannelRow | null) ?? null;
}

/**
 * Pide lugar en la ventana de la hora.
 *
 * El tope es de Instagram; los demas canales no lo tienen, asi que no se les
 * aplica. Si la funcion de base falla (no por tope, sino por un error), se deja
 * pasar el envio: perder un mensaje por un problema del contador seria peor que
 * el riesgo de pasarse por uno.
 */
async function claimSend(
  supabase: SupabaseClient<Database>,
  channel: ChannelRow
): Promise<boolean> {
  if (channel.platform !== "instagram" && channel.platform !== "facebook") return true;

  const { data, error } = await supabase.rpc("claim_automated_send", {
    p_channel_id: channel.id,
    p_limit: INSTAGRAM_HOURLY_LIMIT,
  });

  if (error) {
    console.error("[send] no pude reclamar el envio, dejo pasar:", error.message);
    return true;
  }
  return data !== false;
}

async function sendViaZernio(
  supabase: SupabaseClient<Database>,
  context: SendContext,
  channel: ChannelRow,
  message: OutboundMessage
): Promise<SendOutcome> {
  const apiKey = await getZernioApiKey(context.workspaceId, { supabase });
  if (!apiKey) {
    return {
      ok: false,
      failure: {
        kind: "token_expired",
        message: "La cuenta de Instagram no esta conectada.",
        hint: "Hay que conectarla desde Canales para que el sistema pueda enviar.",
        retryable: false,
      },
    };
  }

  const lateAccountId = context.lateAccountId ?? channel.late_account_id;
  const lateConversationId = context.lateConversationId ?? (await resolveLateConversation(supabase, context));

  if (!lateAccountId || !lateConversationId) {
    return {
      ok: false,
      failure: {
        kind: "unknown",
        message: "Todavia no hay una conversacion abierta con este contacto.",
        hint: "Instagram solo permite escribir a quien escribio primero.",
        retryable: false,
      },
    };
  }

  const body: Record<string, unknown> = { accountId: lateAccountId, message: message.text };
  if (message.mediaUrl) {
    body.attachmentUrl = message.mediaUrl;
    body.attachmentType = message.mediaType || "image";
  }
  if (message.buttons?.length) body.buttons = message.buttons;
  if (message.quickReplies?.length) body.quickReplies = message.quickReplies;
  if (message.template) body.template = message.template;
  if (message.replyMarkup) body.replyMarkup = message.replyMarkup;

  try {
    const zernio = createZernioClient(apiKey);
    const response = await zernio.messages.sendInboxMessage({
      path: { conversationId: lateConversationId },
      body: body as Parameters<typeof zernio.messages.sendInboxMessage>[0]["body"],
    });
    return { ok: true, platformMessageId: response.data?.data?.messageId || null };
  } catch (error) {
    // No se loguea el error crudo con su contenido: puede traer el texto del
    // mensaje y datos del contacto. Alcanza con el motivo.
    const failure = describeSendError(error);
    console.error(`[send] Instagram rechazo el envio (${failure.kind})`);
    return { ok: false, failure };
  }
}

/**
 * Envio por WhatsApp.
 *
 * Escrito y listo, sin probar en vivo: todavia no hay ningun numero conectado.
 * Cuando se conecte, esto se prueba, no se reescribe.
 */
async function sendViaEvolution(
  supabase: SupabaseClient<Database>,
  context: SendContext,
  channel: ChannelRow,
  message: OutboundMessage
): Promise<SendOutcome> {
  const config = getEvolutionConfig();
  if (!config || !channel.evolution_instance) {
    return {
      ok: false,
      failure: {
        kind: "token_expired",
        message: "WhatsApp no esta configurado en este entorno.",
        hint: "Hay que conectar el numero desde Canales.",
        retryable: false,
      },
    };
  }

  const { data: link } = await supabase
    .from("contact_channels")
    .select("platform_sender_id")
    .eq("channel_id", channel.id)
    .eq("contact_id", context.contactId)
    .maybeSingle();

  if (!link?.platform_sender_id) {
    return {
      ok: false,
      failure: {
        kind: "user_unavailable",
        message: "Este contacto no tiene un numero de WhatsApp vinculado.",
        retryable: false,
      },
    };
  }

  try {
    const sent = await sendText(
      config,
      channel.evolution_instance,
      link.platform_sender_id,
      message.text
    );
    return { ok: true, platformMessageId: sent.id };
  } catch (error) {
    const detail = error instanceof EvolutionError ? error.message : "error desconocido";
    console.error("[send] WhatsApp rechazo el envio:", detail);
    return {
      ok: false,
      failure: {
        kind: "unknown",
        message: "No se pudo enviar el mensaje por WhatsApp.",
        hint: "Puede que el numero se haya desconectado. Conviene revisar el estado del canal.",
        retryable: true,
      },
    };
  }
}

async function resolveLateConversation(
  supabase: SupabaseClient<Database>,
  context: SendContext
): Promise<string | null> {
  if (!context.conversationId) return null;
  const { data } = await supabase
    .from("conversations")
    .select("late_conversation_id")
    .eq("id", context.conversationId)
    .single();
  return data?.late_conversation_id ?? null;
}

/**
 * Deja registrado el resultado del envio.
 *
 * Un envio fallido guarda el motivo legible en el mensaje, que es lo que
 * despues muestra la bandeja: antes quedaba una fila `failed` sin texto y sin
 * explicacion, y el operador no tenia como saber que habia pasado.
 */
export async function recordSend(
  supabase: SupabaseClient<Database>,
  context: SendContext,
  text: string,
  outcome: SendOutcome,
  attachments?: unknown[] | null
): Promise<void> {
  await supabase.from("messages").insert({
    conversation_id: context.conversationId,
    direction: "outbound",
    text,
    attachments: (attachments as never) ?? null,
    sent_by_flow_id: context.flowId ?? null,
    platform_message_id: outcome.platformMessageId ?? null,
    status: outcome.ok ? "sent" : "failed",
  });

  await supabase.from("analytics_events").insert({
    workspace_id: context.workspaceId,
    flow_id: context.flowId ?? null,
    contact_id: context.contactId,
    event_type: outcome.ok ? "message_sent" : "message_failed",
    metadata: outcome.ok
      ? null
      : {
          reason: outcome.failure?.kind ?? "unknown",
          message: outcome.failure?.message ?? null,
          hint: outcome.failure?.hint ?? null,
        },
  });
}
