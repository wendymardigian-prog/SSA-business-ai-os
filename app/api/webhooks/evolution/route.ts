/**
 * Receptor de los webhooks de Evolution API (WhatsApp por Baileys).
 *
 * Evolution manda dos eventos que nos importan:
 * - messages.upsert: mensaje nuevo, del lead o mandado desde el celular
 * - connection.update: la sesion se abrio, se esta abriendo o se cayo
 *
 * Autenticacion: esta URL es publica, asi que se exige el header
 * x-webhook-token, el mismo que se configura al crear la instancia
 * (lib/evolution-client.ts). Sin eso, cualquiera que descubra la URL podria
 * inyectar mensajes falsos en la bandeja.
 *
 * A diferencia de Instagram, los mensajes de WhatsApp SI se guardan en la tabla
 * local: Evolution no tiene una API donde vivan, asi que nuestra base es la
 * fuente de verdad del hilo.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { upsertContactForSender } from "@/lib/inbox-sync";
import { messagePreview } from "@/lib/message-preview";
import { jidToPhone } from "@/lib/phone";
import {
  describeAttachment,
  extractText,
  messageTimestamp,
} from "@/lib/evolution-message";
import { constantTimeEquals } from "@/lib/crypto";
import {
  applyOptOut,
  pauseSequencesOnReply,
  claimWebhookEvent,
  insertMessage,
  runInboundAutomation,
  upsertConversation,
  type ChannelRow,
} from "@/lib/inbound";

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

type Db = Awaited<ReturnType<typeof createServiceClient>>;

/** "MESSAGES_UPSERT" y "messages.upsert" son el mismo evento segun la version. */
function normalizeEvent(event: string | undefined): string {
  return (event ?? "").toLowerCase().replace(/_/g, ".");
}

export async function POST(request: NextRequest) {
  try {
    return await handleWebhook(request);
  } catch (err) {
    // Nunca se devuelve el detalle: quien llama es un endpoint publico.
    console.error("[evolution] error procesando el webhook:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function handleWebhook(request: NextRequest) {
  const expected = process.env.EVOLUTION_WEBHOOK_TOKEN?.trim();
  if (!expected) {
    console.error("[evolution] falta EVOLUTION_WEBHOOK_TOKEN en el entorno");
    return NextResponse.json({ error: "Webhook no configurado" }, { status: 500 });
  }

  const provided = request.headers.get("x-webhook-token");
  if (!provided || !constantTimeEquals(provided, expected)) {
    return NextResponse.json({ error: "Token invalido" }, { status: 401 });
  }

  const body = await request.text();
  let payload: EvolutionPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const instance = payload.instance;
  if (!instance) {
    return NextResponse.json({ ok: true, skipped: "sin instancia" });
  }

  const supabase = await createServiceClient();

  const { data: channel } = await supabase
    .from("channels")
    .select("*")
    .eq("evolution_instance", instance)
    .maybeSingle();

  // El mismo Evolution puede estar compartido con otro sistema: una instancia
  // que no es nuestra se ignora sin ruido, no es un error.
  if (!channel) {
    return NextResponse.json({ ok: true, skipped: "instancia desconocida" });
  }

  const event = normalizeEvent(payload.event);

  // Es una sola escritura y no dispara nada: se resuelve en el momento.
  if (event === "connection.update") {
    return handleConnectionUpdate(supabase, channel, payload);
  }

  if (event !== "messages.upsert") {
    return NextResponse.json({ ok: true, skipped: event || "sin evento" });
  }

  const jid = payload.data?.key?.remoteJid;
  const phone = jidToPhone(jid);

  // Grupos (@g.us) y JIDs anonimizados (@lid) no traen un telefono real detras,
  // asi que no hay un lead a quien atribuirle el mensaje.
  if (!phone) {
    return NextResponse.json({ ok: true, skipped: "sin telefono utilizable" });
  }

  const messageId = payload.data?.key?.id ?? null;
  const claimed = await claimWebhookEvent(
    supabase,
    messageId ? `evolution:${channel.id}:${messageId}` : null,
  );
  if (!claimed) {
    return NextResponse.json({ ok: true, skipped: "evento repetido" });
  }

  // Se responde 200 y se procesa despues: resolver el contacto y correr el flow
  // (que manda mensajes y puede llamar a un modelo de IA) no puede pasar antes
  // de contestarle a Evolution.
  after(async () => {
    try {
      await processMessage(supabase, channel, payload, phone);
    } catch (err) {
      console.error("[evolution] error procesando el mensaje:", err);
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}

async function handleConnectionUpdate(
  supabase: Db,
  channel: ChannelRow,
  payload: EvolutionPayload,
) {
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
        // Se limpia para que la proxima caida vuelva a avisar a los admins
        // (el aviso lo manda /api/cron/whatsapp-health).
        disconnected_notified_at: null,
      })
      .eq("id", channel.id);
  } else if (state === "close") {
    // 401 es "cerraron la sesion desde el telefono": no alcanza con esperar,
    // hay que volver a escanear el QR.
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

  return NextResponse.json({ ok: true, state: state ?? null });
}

async function processMessage(
  supabase: Db,
  channel: ChannelRow,
  payload: EvolutionPayload,
  phone: string,
) {
  const data = payload.data;
  const messageId = data?.key?.id ?? null;
  const fromMe = data?.key?.fromMe === true;

  const text = extractText(data?.message);
  const preview = messagePreview(text) || describeAttachment(data?.messageType) || "";
  const at = messageTimestamp(data?.messageTimestamp);

  const contact = await upsertContactForSender({
    supabase,
    channel,
    senderId: phone,
    // Si el mensaje salio de nuestro telefono, pushName es nuestro nombre, no
    // el del lead: se usa el numero antes que ensuciar la ficha.
    senderName: (!fromMe && data?.pushName) || phone,
    senderUsername: phone,
    senderPicture: null,
    // El telefono es la clave fuerte de deduplicacion: si este lead ya escribio
    // por Instagram y alguien le cargo el numero, se vincula al mismo contacto
    // en vez de crear uno nuevo (find_or_link_contact, migracion 00025).
    senderPhone: phone,
    interactionAt: at,
  });

  if (!contact) {
    console.error("[evolution] no pude resolver el contacto del mensaje");
    return;
  }

  const conversation = await upsertConversation({
    supabase,
    channel,
    contactId: contact.contactId,
    preview,
    at,
    incrementUnread: !fromMe,
  });

  if (!conversation) return;

  // Lo que se manda desde el celular tambien se guarda: si la operadora contesta
  // por WhatsApp Web o desde el telefono, el hilo de la bandeja tiene que
  // mostrarlo. El indice unico (conversation_id, platform_message_id) evita
  // duplicar el eco del mensaje que ya guardamos al enviarlo desde la app.
  //
  // No pasa por persistInboundMessage, que es solo para entrantes y ademas
  // consulta el interruptor: este insert cubre las dos direcciones, y para
  // WhatsApp esta tabla es la unica fuente del hilo. Apagar el guardado aca no
  // seria "no guardar", seria vaciar la bandeja.
  await insertMessage({
    supabase,
    conversationId: conversation.id,
    direction: fromMe ? "outbound" : "inbound",
    text,
    platformMessageId: messageId,
    attachments: text ? null : (data?.message ?? null),
    createdAt: at,
    workspaceId: channel.workspace_id,
  });

  // Lo que escribimos nosotros no se evalua: ni marca opt-out ni dispara flows.
  if (fromMe) return;

  // El lead contesto: se frena el seguimiento automatico de este canal (F11).
  // Los de otros canales siguen corriendo, que es lo que hace conviviles a
  // varias secuencias a la vez (F12).
  await pauseSequencesOnReply({
    supabase,
    contactId: contact.contactId,
    channelId: channel.id,
  });

  // Antes de automatizar: si el lead acaba de pedir que dejen de escribirle, no
  // se le contesta con un bot.
  const optOut = await applyOptOut({
    supabase,
    contactId: contact.contactId,
    conversationId: conversation.id,
    text,
  });
  if (optOut.matched) return;

  await runInboundAutomation({
    supabase,
    channel,
    contactId: contact.contactId,
    conversationId: conversation.id,
    isAutomationPaused: conversation.isAutomationPaused,
    isFirstMessage: !contact.existed,
    incomingMessage: {
      text: text || undefined,
      sender: { id: phone, name: data?.pushName || undefined },
    },
  });
}
