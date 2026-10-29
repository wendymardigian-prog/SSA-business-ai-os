import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import { sendText, sendWhatsAppAudio, sendMedia, sendSticker, EvolutionError, type EvolutionConfig } from "@/lib/evolution-client";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { describeSendError, RATE_LIMIT_REACHED, type FriendlyError } from "@/lib/instagram-errors";
import { outboundMessageRow } from "@/lib/messages/outbound";
import { sentContentContext } from "@/lib/attribution/content-variables";
import { CHAT_MEDIA_BUCKET } from "@/lib/chat-media/bucket";
import { instagramAcceptsAudio, INSTAGRAM_AUDIO_REJECTED_MESSAGE } from "@/lib/audio/recording";
import { foldOptionsIntoText } from "./platform-adapter";
import type { EmailCategory, EmailSkipReason } from "@/lib/email/subscription";
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
/** El tope por hora de los envios automaticos por WhatsApp, por canal. */
const WHATSAPP_HOURLY_LIMIT = 200;

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
  /** Nodo del flow que originó el envío, para atribuir el saliente (F2). */
  nodeId?: string | null;
  /**
   * Origen del saliente (F2). Por defecto `flow`; las secuencias pasan
   * `sequence`. Determina `messages.origin`.
   */
  origin?: "flow" | "sequence";
  /** Las variables del flujo (si el envío nace de uno): de ahí sale la pieza (`content`) que guarda el saliente (F35). */
  variables?: Record<string, unknown>;
  /**
   * Suscripcion a emails (E2): solo cuenta si la conversacion es de email. Sin esto, `channelEmailCategory` decide:
   * marketing en flujos y secuencias, transaccional en el agente (que responde a alguien que escribio).
   */
  emailCategory?: EmailCategory;
}

/**
 * La categoria de un email que sale por `sendChannelMessage`. Lo que nace de un flujo o de una secuencia es marketing
 * salvo que el paso diga otra cosa; lo demas (el agente respondiendo un hilo) es transaccional.
 */
export function channelEmailCategory(context: Pick<SendContext, "emailCategory" | "origin" | "flowId">): EmailCategory {
  if (context.emailCategory) return context.emailCategory;
  return context.origin === "sequence" || context.flowId ? "marketing" : "transactional";
}

/** Un archivo de nuestro bucket `chat-media`, listo para mandar (F19). */
export interface OutboundMedia {
  /** `sticker` solo por WhatsApp (lib/channels/stickers.ts). */
  kind: "audio" | "voice" | "image" | "video" | "document" | "sticker";
  /** Ruta en el bucket chat-media. */
  storagePath: string;
  mime: string;
  filename?: string | null;
  durationSeconds?: number | null;
}

export interface OutboundMessage {
  text: string;
  /** Legado: una URL ya publica (el patron de send-message.ts). Convive con `media`. */
  mediaUrl?: string;
  mediaType?: string;
  /** Un archivo de chat-media, el camino nuevo (F19): la bandeja y la banca de audios lo usan. */
  media?: OutboundMedia;
  buttons?: unknown[];
  quickReplies?: unknown[];
  template?: unknown;
  replyMarkup?: unknown;
}

/**
 * Opciones del envio.
 *
 * `secrets` es el cliente con el que se leen las claves del proveedor (Zernio,
 * Evolution, Resend). Por defecto es el mismo `supabase` del envio, que en los
 * flows, las secuencias y el agente ya es el de servicio. La bandeja manda con
 * el cliente del usuario (asi la RLS decide que conversacion ve y el tope de
 * envios automaticos no le aplica), y pasa aca el de servicio: desde la 00143
 * `read_secret` solo la puede ejecutar el servidor.
 */
export interface SendOptions {
  secrets?: SupabaseClient<Database>;
}

export interface SendOutcome {
  ok: boolean;
  platformMessageId?: string | null;
  /** Solo si ok es false. Ya viene traducido para mostrarle a una persona. */
  failure?: FriendlyError;
  /** Solo email: la puerta de suscripcion lo salteo (la persona se dio de baja, rebota o marco spam). */
  skipped?: EmailSkipReason;
}

interface ChannelRow {
  id: string;
  provider: string;
  platform: string;
  late_account_id: string | null;
  evolution_instance: string | null;
  workspace_id: string;
  email_address: string | null;
  is_active: boolean;
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
  message: OutboundMessage,
  options: SendOptions = {},
): Promise<SendOutcome> {
  const secrets = options.secrets ?? supabase;
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
    return sendViaEvolution(supabase, secrets, context, channel, message);
  }
  // Rama explicita y no un `else`: un canal nuevo que caiga por default en
  // Zernio manda un mensaje al lugar equivocado sin avisar.
  if (channel.provider === "resend") {
    return sendViaResendChannel(supabase, secrets, context, channel, message);
  }
  return sendViaZernio(supabase, secrets, context, channel, message);
}

async function loadChannel(
  supabase: SupabaseClient<Database>,
  channelId: string
): Promise<ChannelRow | null> {
  const { data } = await supabase
    .from("channels")
    .select("id, provider, platform, late_account_id, evolution_instance, workspace_id, email_address, is_active")
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
  // WhatsApp tambien (auditoria de automatizaciones): un numero conectado por QR que manda cientos de mensajes por hora
  // corre riesgo de bloqueo, y un flujo en ciclo con un "Esperar" no tenia ningun freno. Es el mismo tope que ya usa
  // «Enviar WhatsApp a un número».
  const limit =
    channel.platform === "instagram" || channel.platform === "facebook"
      ? INSTAGRAM_HOURLY_LIMIT
      : channel.platform === "whatsapp"
        ? WHATSAPP_HOURLY_LIMIT
        : null;
  if (limit === null) return true;

  const { data, error } = await supabase.rpc("claim_automated_send", {
    p_channel_id: channel.id,
    p_limit: limit,
  });

  if (error) {
    console.error("[send] no pude reclamar el envio, dejo pasar:", error.message);
    return true;
  }
  return data !== false;
}

/**
 * Responde por email (F65).
 *
 * Un flow que manda un mensaje sobre una conversacion de email responde el
 * hilo. La alternativa —rechazarlo— obligaria a armar un flow distinto por
 * canal para hacer lo mismo.
 */
async function sendViaResendChannel(
  supabase: SupabaseClient<Database>,
  secrets: SupabaseClient<Database>,
  context: SendContext,
  channel: ChannelRow,
  message: OutboundMessage
): Promise<SendOutcome> {
  const { sendEmailReply } = await import("@/lib/email/send-reply");

  const text = message.text?.trim();
  if (!text) {
    return {
      ok: false,
      failure: {
        kind: "unknown",
        message: "Un email no puede ir vacio.",
        retryable: false,
      },
    };
  }

  const { data: contact } = await supabase
    .from("contacts")
    .select("email, do_not_contact")
    .eq("id", context.contactId)
    .maybeSingle();

  const result = await sendEmailReply(supabase, {
    workspaceId: context.workspaceId,
    conversationId: context.conversationId,
    channel: {
      platform: channel.platform,
      is_active: channel.is_active,
      email_address: channel.email_address,
    },
    toAddress: contact?.email ?? null,
    text,
    contactOptedOut: contact?.do_not_contact === true,
    secrets,
    category: channelEmailCategory(context),
    contactId: context.contactId,
    // Lo que manda un flujo o una secuencia queda en email_log (historial del contacto, y el webhook de Resend
    // ubica un rebote por su id). El agente no: su respuesta ya queda en el hilo.
    ...(context.origin === "sequence" || context.flowId
      ? { log: { kind: context.origin === "sequence" ? "sequence" : "flow_message", ...(context.flowId ? { relatedEntityType: "flow", relatedEntityId: context.flowId } : {}) } }
      : {}),
  });

  if (!result.ok) {
    return {
      ok: false,
      ...(result.skipped ? { skipped: result.skipped } : {}),
      failure: {
        // `rate_limited` es lo mas cercano que hay en la union para "el
        // proveedor no contesto, proba de nuevo": lo que importa para el
        // motor es `retryable`, no la etiqueta.
        kind: result.retryable ? "rate_limited" : "unknown",
        message: result.error ?? "No pude mandar el email.",
        retryable: result.retryable === true,
      },
    };
  }

  return { ok: true, platformMessageId: result.messageId };
}

/** El `attachmentType` que entiende `sendInboxMessage`: solo cuatro valores. */
function zernioAttachmentType(kind: Exclude<OutboundMedia["kind"], "sticker">): "image" | "video" | "audio" | "file" {
  if (kind === "voice") return "audio";
  if (kind === "document") return "file";
  return kind;
}

/**
 * Sube un archivo de chat-media a Zernio y devuelve su URL publica (F19).
 *
 * Zernio exige una URL publica SIN autenticacion ni redirects como
 * `attachmentUrl`: una URL firmada de Supabase no sirve (trae un token en la
 * query, y no hay garantia de que Zernio la acepte asi). `uploadMediaDirect`
 * resuelve esto subiendo el archivo y devolviendo una URL que Zernio mismo
 * hospeda. Mismo patron que `lib/publishing/zernio-media.ts` para contenido.
 */
async function uploadToZernioDirect(
  supabase: SupabaseClient<Database>,
  zernio: ReturnType<typeof createZernioClient>,
  media: OutboundMedia,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const { data, error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).download(media.storagePath);
  if (error || !data) {
    return { ok: false, message: "No pude leer el archivo para subirlo a Instagram." };
  }

  try {
    const blob = new Blob([await data.arrayBuffer()], { type: media.mime });
    const result = await zernio.messages.uploadMediaDirect({ body: { file: blob, contentType: media.mime } });
    const url = (result.data as { url?: string } | undefined)?.url;
    if (!url) return { ok: false, message: "Instagram no me dio una URL para el archivo." };
    return { ok: true, url };
  } catch {
    return { ok: false, message: "No se pudo subir el archivo a Instagram." };
  }
}

async function sendViaZernio(
  supabase: SupabaseClient<Database>,
  secrets: SupabaseClient<Database>,
  context: SendContext,
  channel: ChannelRow,
  message: OutboundMessage
): Promise<SendOutcome> {
  const apiKey = await getZernioApiKey(context.workspaceId, { supabase: secrets });
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

  const zernio = createZernioClient(apiKey);
  const body: Record<string, unknown> = { accountId: lateAccountId, message: message.text };

  if (message.media) {
    // Instagram no recibe stickers (lib/channels/stickers.ts): no se sube nada.
    if (message.media.kind === "sticker") {
      return {
        ok: false,
        failure: { kind: "unknown", message: "Instagram no permite mandar stickers desde acá.", retryable: false },
      };
    }
    // Antes de subir nada: un ogg/webm/mp3 Instagram lo va a tirar igual.
    if (
      (message.media.kind === "audio" || message.media.kind === "voice") &&
      !instagramAcceptsAudio(message.media.mime)
    ) {
      return {
        ok: false,
        failure: { kind: "unknown", message: INSTAGRAM_AUDIO_REJECTED_MESSAGE, retryable: false },
      };
    }

    const uploaded = await uploadToZernioDirect(supabase, zernio, message.media);
    if (!uploaded.ok) {
      return { ok: false, failure: { kind: "unknown", message: uploaded.message, retryable: true } };
    }
    body.attachmentUrl = uploaded.url;
    body.attachmentType = zernioAttachmentType(message.media.kind);
  } else if (message.mediaUrl) {
    body.attachmentUrl = message.mediaUrl;
    body.attachmentType = message.mediaType || "image";
  }

  if (message.buttons?.length) body.buttons = message.buttons;
  if (message.quickReplies?.length) body.quickReplies = message.quickReplies;
  if (message.template) body.template = message.template;
  if (message.replyMarkup) body.replyMarkup = message.replyMarkup;

  try {
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

/** Cuanto vive la URL firmada que se le pasa a Evolution: le alcanza con pedirla una vez. */
const EVOLUTION_MEDIA_URL_SECONDS = 10 * 60;

async function chatMediaSignedUrl(
  supabase: SupabaseClient<Database>,
  storagePath: string,
  expiresInSeconds: number,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Nota de voz nativa si es audio/voice; sendMedia para el resto. Un solo lugar para los dos caminos (`media` y el `mediaUrl` legado). */
async function sendEvolutionMediaMessage(
  config: EvolutionConfig,
  instanceName: string,
  to: string,
  args: { url: string; kind: string; mime?: string | null; filename?: string | null; caption?: string },
) {
  if (args.kind === "audio" || args.kind === "voice") {
    // Por WhatsApp no se valida el formato: Evolution convierte cualquiera
    // con su propio ffmpeg (encoding:true, el default).
    return sendWhatsAppAudio(config, instanceName, to, args.url);
  }
  if (args.kind === "sticker") {
    // Un sticker no lleva texto: si viene uno, lo manda el que llama aparte.
    return sendSticker(config, instanceName, to, args.url);
  }
  const mediatype = args.kind === "document" ? "document" : args.kind === "video" ? "video" : "image";
  return sendMedia(config, instanceName, to, {
    media: args.url,
    mediatype,
    mimetype: args.mime,
    fileName: args.filename,
    caption: args.caption,
  });
}

/**
 * Envio por WhatsApp.
 *
 * **El arreglo del bug (F19):** antes esta rama solo mandaba texto; un flow
 * con `mediaUrl` registraba en la base un adjunto que NUNCA se enviaba. Ahora
 * `message.media` (chat-media, F19) y `message.mediaUrl` (legado, el patron
 * de send-message.ts) se mandan los dos.
 */
async function sendViaEvolution(
  supabase: SupabaseClient<Database>,
  secrets: SupabaseClient<Database>,
  context: SendContext,
  channel: ChannelRow,
  message: OutboundMessage
): Promise<SendOutcome> {
  const config = await getEvolutionConfig(secrets, channel.workspace_id);
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

  return sendEvolutionDirect(supabase, config, channel.evolution_instance, link.platform_sender_id, message);
}

/**
 * Manda el mensaje a un número de WhatsApp con Evolution, sin mirar contactos ni conversaciones (Tirón 2, D3).
 *
 * Es el tramo final de `sendViaEvolution`, sin cambios: texto, un archivo de `chat-media` o una URL pública, y el
 * mismo manejo del error del proveedor. El paso «Enviar WhatsApp a un número» lo usa para avisar a alguien que no es
 * un contacto (por ejemplo, el aviso a la dueña); el resto del motor sigue entrando por `sendChannelMessage`.
 */
export async function sendEvolutionDirect(
  supabase: SupabaseClient<Database>,
  config: EvolutionConfig,
  instance: string,
  number: string,
  rawMessage: OutboundMessage
): Promise<SendOutcome> {
  // Evolution manda texto o media, nada interactivo: los botones y las respuestas rapidas van como lista numerada.
  const message: OutboundMessage =
    rawMessage.buttons?.length || rawMessage.quickReplies?.length
      ? { ...rawMessage, text: foldOptionsIntoText(rawMessage.text ?? "", rawMessage.buttons, rawMessage.quickReplies), buttons: undefined, quickReplies: undefined }
      : rawMessage;
  try {
    if (message.media) {
      const signedUrl = await chatMediaSignedUrl(supabase, message.media.storagePath, EVOLUTION_MEDIA_URL_SECONDS);
      if (!signedUrl) {
        return {
          ok: false,
          failure: { kind: "unknown", message: "No pude preparar el archivo para enviarlo.", retryable: true },
        };
      }
      const sent = await sendEvolutionMediaMessage(config, instance, number, {
        url: signedUrl,
        kind: message.media.kind,
        mime: message.media.mime,
        filename: message.media.filename,
        caption: message.text || undefined,
      });
      return { ok: true, platformMessageId: sent.id };
    }

    if (message.mediaUrl) {
      const sent = await sendEvolutionMediaMessage(config, instance, number, {
        url: message.mediaUrl,
        kind: message.mediaType || "image",
        caption: message.text || undefined,
      });
      return { ok: true, platformMessageId: sent.id };
    }

    const sent = await sendText(
      config,
      instance,
      number,
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
  /** El VALOR DE LA COLUMNA ya armado: `{v:2, items}` (toAttachmentsColumn) o, legado, el array `[{type,url}]`. */
  attachments?: unknown | null
): Promise<void> {
  await supabase.from("messages").insert(
    outboundMessageRow({
      conversationId: context.conversationId,
      origin: context.origin ?? "flow",
      text,
      attachments: attachments ?? null,
      sentByFlowId: context.flowId ?? null,
      sentByNodeId: context.nodeId ?? null,
      platformMessageId: outcome.platformMessageId ?? null,
      status: outcome.ok ? "sent" : "failed",
      originContext: sentContentContext(context),
    }),
  );

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
