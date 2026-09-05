/**
 * Webhook de Evolution API (WhatsApp por Baileys).
 *
 * Evolution manda dos eventos que nos importan:
 * - messages.upsert: mensaje nuevo (entrante o mandado desde el celular)
 * - connection.update: la sesion se abrio, se esta abriendo o se cayo
 *
 * Autenticacion: esta URL es publica, asi que se exige el header
 * x-webhook-token que configuramos al crear la instancia. Sin eso, cualquiera
 * que descubra la URL podria inyectar mensajes falsos en la bandeja.
 */

import type { SupabaseClient } from "../_shared/db.ts";
import {
  claimEvent,
  insertMessage,
  messagePreview,
  upsertContact,
  upsertConversation,
  type ChannelRow,
} from "../_shared/inbound.ts";
import { timingSafeEqual } from "../_shared/hmac.ts";

interface EvolutionPayload {
  event?: string;
  instance?: string;
  data?: {
    key?: { remoteJid?: string; fromMe?: boolean; id?: string };
    pushName?: string;
    message?: Record<string, unknown>;
    messageType?: string;
    messageTimestamp?: number | string;
    state?: string;
    statusReason?: number;
  };
}

const CHANNEL_FIELDS =
  "id, workspace_id, platform, provider, evolution_instance, username";

/** "MESSAGES_UPSERT" y "messages.upsert" son el mismo evento segun la version. */
function normalizeEvent(event: string | undefined): string {
  return (event ?? "").toLowerCase().replace(/_/g, ".");
}

/**
 * Texto del mensaje. WhatsApp lo mete en un lugar distinto segun el tipo:
 * texto suelto, texto con preview de link, o el pie de una imagen o video.
 */
function extractText(message: Record<string, unknown> | undefined): string | null {
  if (!message) return null;
  const pick = (path: string[]): string | null => {
    let cur: unknown = message;
    for (const key of path) {
      if (typeof cur !== "object" || cur === null) return null;
      cur = (cur as Record<string, unknown>)[key];
    }
    return typeof cur === "string" && cur.length > 0 ? cur : null;
  };

  return (
    pick(["conversation"]) ??
    pick(["extendedTextMessage", "text"]) ??
    pick(["imageMessage", "caption"]) ??
    pick(["videoMessage", "caption"]) ??
    pick(["documentMessage", "caption"]) ??
    pick(["buttonsResponseMessage", "selectedDisplayText"]) ??
    pick(["listResponseMessage", "title"]) ??
    null
  );
}

/** Etiqueta legible para un mensaje sin texto, asi el preview no queda vacio. */
function describeAttachment(messageType: string | undefined): string | null {
  const labels: Record<string, string> = {
    imageMessage: "📷 Imagen",
    videoMessage: "🎥 Video",
    audioMessage: "🎤 Audio",
    documentMessage: "📄 Documento",
    stickerMessage: "Sticker",
    locationMessage: "📍 Ubicacion",
    contactMessage: "👤 Contacto",
  };
  return messageType ? (labels[messageType] ?? null) : null;
}

const GROUP_SUFFIX = "@g.us";
const LID_SUFFIX = "@lid";

/** Telefono normalizado a partir del JID. Espejo de jidToPhone en lib/phone.ts. */
function jidToPhone(jid: string | undefined): string | null {
  if (!jid || jid.endsWith(GROUP_SUFFIX) || jid.endsWith(LID_SUFFIX)) return null;
  const digits = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

export async function handleEvolution(
  supabase: SupabaseClient,
  body: string,
  headers: Headers,
): Promise<Response> {
  const expected = Deno.env.get("EVOLUTION_WEBHOOK_TOKEN");
  if (!expected) {
    console.error("[evolution] falta EVOLUTION_WEBHOOK_TOKEN en la Edge Function");
    return json({ error: "webhook no configurado" }, 500);
  }
  const provided = headers.get("x-webhook-token");
  if (!provided || !timingSafeEqual(provided, expected)) {
    return json({ error: "token invalido" }, 401);
  }

  let payload: EvolutionPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ error: "JSON invalido" }, 400);
  }

  const instance = payload.instance;
  if (!instance) return json({ ok: true, skipped: "sin instancia" });

  const { data: channel } = await supabase
    .from("channels")
    .select(CHANNEL_FIELDS)
    .eq("evolution_instance", instance)
    .maybeSingle();

  // Instancia de otro sistema en el mismo Evolution: no es un error, no es nuestra.
  if (!channel) return json({ ok: true, skipped: "instancia desconocida" });

  const event = normalizeEvent(payload.event);

  if (event === "connection.update") {
    return handleConnectionUpdate(supabase, channel as ChannelRow, payload);
  }
  if (event === "messages.upsert") {
    return handleMessage(supabase, channel as ChannelRow, payload);
  }

  return json({ ok: true, skipped: event || "sin evento" });
}

async function handleConnectionUpdate(
  supabase: SupabaseClient,
  channel: ChannelRow,
  payload: EvolutionPayload,
): Promise<Response> {
  const state = payload.data?.state;
  const now = new Date().toISOString();

  if (state === "open") {
    await supabase
      .from("channels")
      .update({
        connection_status: "connected",
        is_active: true,
        last_connected_at: now,
        last_error: null,
        // Se limpia para que la proxima caida vuelva a avisar a los admins.
        disconnected_notified_at: null,
      })
      .eq("id", channel.id);
  } else if (state === "close") {
    // 401 es "cerraron la sesion desde el telefono": hay que volver a escanear.
    const reason =
      payload.data?.statusReason === 401
        ? "Se cerro la sesion desde el telefono. Hay que volver a escanear el QR."
        : "WhatsApp se desconecto.";
    await supabase
      .from("channels")
      .update({ connection_status: "disconnected", last_error: reason })
      .eq("id", channel.id);
  } else if (state === "connecting") {
    await supabase
      .from("channels")
      .update({ connection_status: "connecting" })
      .eq("id", channel.id);
  }

  return json({ ok: true, state: state ?? null });
}

async function handleMessage(
  supabase: SupabaseClient,
  channel: ChannelRow,
  payload: EvolutionPayload,
): Promise<Response> {
  const data = payload.data;
  const jid = data?.key?.remoteJid;
  const messageId = data?.key?.id ?? null;
  const fromMe = data?.key?.fromMe === true;

  const phone = jidToPhone(jid);
  // Grupos y JIDs anonimizados: no hay un lead con telefono detras.
  if (!phone) return json({ ok: true, skipped: "sin telefono utilizable" });

  if (!(await claimEvent(supabase, messageId ? `evolution:${channel.id}:${messageId}` : null))) {
    return json({ ok: true, skipped: "evento repetido" });
  }

  const text = extractText(data?.message);
  const preview = messagePreview(text) || describeAttachment(data?.messageType) || "";

  const tsRaw = data?.messageTimestamp;
  const tsSeconds = typeof tsRaw === "string" ? Number.parseInt(tsRaw, 10) : tsRaw;
  const at =
    tsSeconds && Number.isFinite(tsSeconds)
      ? new Date(tsSeconds * 1000).toISOString()
      : new Date().toISOString();

  const contact = await upsertContact({
    supabase,
    channel,
    senderId: phone,
    // fromMe: el nombre que trae es el nuestro, no el del lead.
    senderName: (!fromMe && data?.pushName) || phone,
    senderUsername: phone,
    interactionAt: at,
  });
  if (!contact) return json({ error: "no pude crear el contacto" }, 500);

  const conversation = await upsertConversation({
    supabase,
    channel,
    contactId: contact.contactId,
    preview,
    at,
    incrementUnread: !fromMe,
  });
  if (!conversation) return json({ error: "no pude crear la conversacion" }, 500);

  // fromMe tambien se guarda: si la operadora contesta desde el celular, el hilo
  // de la bandeja tiene que mostrarlo. El indice unico evita duplicar el mensaje
  // que ya guardo la app cuando el envio salio desde la bandeja.
  await insertMessage({
    supabase,
    conversationId: conversation.id,
    direction: fromMe ? "outbound" : "inbound",
    text,
    platformMessageId: messageId,
    attachments: text ? null : (data?.message ?? null),
    createdAt: at,
  });

  return json({ ok: true, conversationId: conversation.id });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
