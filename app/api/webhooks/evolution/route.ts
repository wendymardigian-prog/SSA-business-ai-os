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
 * Desde la Fase 3 los mensajes de todos los canales se guardan en la tabla
 * local, siempre (ya no hay interruptor). Lo que sigue distinguiendo a WhatsApp
 * es de donde se LEE: Evolution no tiene una API donde vivan los mensajes, asi
 * que nuestra base es la fuente de verdad del hilo (en Instagram la bandeja se
 * lo sigue pidiendo a Zernio).
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { collectSentSticker } from "@/lib/stickers/library";
import { callLabel, parseCallEvent, type ParsedCallEvent } from "@/lib/whatsapp-calls/event";
import { notifyMissedCall } from "@/lib/whatsapp-calls/notify";
import { upsertContactForSender } from "@/lib/inbox-sync";
import { touchAccountOf } from "@/lib/inbox/accounts";
import { refreshWhatsappIdentity } from "@/lib/whatsapp-identity";
import { previewForMessage } from "@/lib/message-preview";
import { hasDownloadableMedia, toAttachmentsColumn } from "@/lib/messages/attachments";
import { describeWhatsappMessage, storeEvolutionMedia } from "@/lib/evolution-media";
import { afterMediaStored } from "@/lib/chat-media/after-stored";
import { fromBaileysMessage, recordInboundTouch } from "@/lib/contacts/touch-inbound";
import { adOriginOfBaileys, buildOriginContext } from "@/lib/messages/origin-context";
import { inheritedContentContext, resolveInboundOriginExtras } from "@/lib/attribution/inbound-origin";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { fetchProfilePictureUrl } from "@/lib/evolution-client";
import { maybeStoreContactAvatar } from "@/lib/contacts/avatar";
import { resolveWhatsappSender, type WhatsappMessageKey, type WhatsappSender } from "@/lib/whatsapp-sender";
import { handleWhatsappReaction, parseBaileysReaction } from "@/lib/messages/reactions-inbound";
import {
  describeAttachment,
  extractText,
  messageTimestamp,
} from "@/lib/evolution-message";
import { constantTimeEquals } from "@/lib/crypto";
import { getEvolutionWebhookToken } from "@/lib/evolution-config";
import {
  applyOptOut,
  pauseSequencesOnReply,
  claimWebhookEvent,
  insertMessage,
  runInboundAutomation,
  upsertConversation,
  type ChannelRow,
} from "@/lib/inbound";
import { maybeScheduleAgentTurn } from "@/lib/agent/dispatch";
import { discardPendingDrafts, supersedePendingDrafts } from "@/lib/agent/drafts/lifecycle";
import { AUTO_DISCARD } from "@/lib/agent/drafts/types";

interface EvolutionPayload {
  event?: string;
  instance?: string;
  data?: {
    key?: WhatsappMessageKey & { fromMe?: boolean; id?: string };
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
  // El token es por workspace (F4), asi que primero hay que saber de que
  // workspace es este mensaje, y eso sale de la instancia que viene en el
  // cuerpo. Leer el cuerpo antes de validar no abre nada: lo unico que se hace
  // con el es buscar un canal por su nombre de instancia, y sin token valido
  // no se procesa ni se escribe nada.
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

  // Vault del workspace del canal y, si no hay, la variable de entorno: es el
  // camino que deja a WhatsApp funcionando igual que antes mientras la clave
  // no se haya movido. Sin canal conocido queda el token del entorno, que es
  // lo que se validaba siempre.
  const expected = await getEvolutionWebhookToken(supabase, channel?.workspace_id ?? null);
  if (!expected) {
    console.error("[evolution] no hay token de webhook ni en Vault ni en el entorno");
    return NextResponse.json({ error: "Webhook no configurado" }, { status: 500 });
  }

  const provided = request.headers.get("x-webhook-token");
  if (!provided || !constantTimeEquals(provided, expected)) {
    return NextResponse.json({ error: "Token invalido" }, { status: 401 });
  }

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

  // Llamadas de WhatsApp (00258): Evolution no las puede atender, solo avisa. Quedan en el
  // hilo y una perdida avisa al responsable. No es un mensaje.
  if (event === "call") {
    const call = parseCallEvent(payload.data);
    // `parseCallEvent` ya prefiere el telefono real (callerPn) a un @lid; si solo hay
    // @lid, la llamada igual se registra en su conversacion.
    const caller = call ? resolveWhatsappSender({ remoteJid: call.fromJid }) : null;
    if (!call || !caller) return NextResponse.json({ ok: true, skipped: "llamada sin remitente utilizable" });
    after(async () => {
      try {
        await processCall(supabase, channel, call, caller);
      } catch (err) {
        console.error("[evolution] error procesando la llamada:", err instanceof Error ? err.message : err);
      }
    });
    return NextResponse.json({ ok: true, queued: "call" });
  }

  if (event !== "messages.upsert") {
    return NextResponse.json({ ok: true, skipped: event || "sin evento" });
  }

  // Quien es la otra persona: su telefono o, si WhatsApp no lo comparte, su @lid.
  // Antes un @lid se descartaba aca ("sin telefono utilizable") y esa conversacion
  // nunca entraba al sistema. Grupos, estados y canales siguen afuera: no son un lead.
  const resolved = resolveWhatsappSender(payload.data?.key);
  if (!resolved) {
    return NextResponse.json({ ok: true, skipped: "no es una conversacion con una persona" });
  }
  const sender = await withKnownLid(supabase, channel, resolved);

  // Una reaccion NO es un mensaje (A3): se guarda aparte y el camino termina aca. Si siguiera, entraria como un
  // entrante vacio, sumaria un no leido y le daria turno al flow o al agente por algo que nadie dijo.
  const reaction = parseBaileysReaction(payload.data?.message);
  if (reaction) {
    const outcome = await handleWhatsappReaction(supabase, channel, {
      senderId: sender.id,
      reaction,
      fromMe: payload.data?.key?.fromMe === true,
    });
    return NextResponse.json({ ok: true, handled: "reaction", outcome });
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
      await processMessage(supabase, channel, payload, sender);
    } catch (err) {
      console.error("[evolution] error procesando el mensaje:", err);
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}

/**
 * Un evento de llamada: el contacto y la conversacion por el camino de
 * siempre, la transicion en la base (`record_whatsapp_call`, atomica) y, si la
 * llamada RECIEN quedo sin atender, un no leido, el preview y el aviso.
 */
async function processCall(supabase: Db, channel: ChannelRow, call: ParsedCallEvent, caller: WhatsappSender) {
  const sender = await withKnownLid(supabase, channel, caller);
  const contact = await upsertContactForSender({
    supabase,
    channel,
    senderId: sender.id,
    senderName: sender.phone ?? UNKNOWN_WHATSAPP_NAME,
    senderUsername: sender.phone,
    senderPicture: null,
    senderPhone: sender.phone,
    interactionAt: call.at,
  });
  if (!contact) {
    console.error("[evolution] no pude resolver el contacto de la llamada");
    return;
  }

  // Sin tocar el preview ni los no leidos todavia: eso solo si nadie atiende.
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("channel_id", channel.id)
    .eq("contact_id", contact.contactId)
    .maybeSingle();
  const conversationId =
    existing?.id ??
    (
      await upsertConversation({
        supabase,
        channel,
        contactId: contact.contactId,
        preview: `📞 ${callLabel({ status: "ringing", isVideo: call.isVideo })}`,
        at: call.at,
        incrementUnread: false,
      })
    )?.id;
  if (!conversationId) return;

  const { data, error } = await supabase.rpc("record_whatsapp_call", {
    p_workspace_id: channel.workspace_id,
    p_channel_id: channel.id,
    p_conversation_id: conversationId,
    p_call_id: call.callId,
    p_is_video: call.isVideo,
    p_event: call.event,
    p_at: call.at,
  });
  if (error) {
    console.error("[evolution] no pude registrar la llamada:", error.message);
    return;
  }
  const result = (data ?? {}) as { status?: string; became_unanswered?: boolean };
  if (!result.became_unanswered || !result.status) return;

  const label = callLabel({ status: result.status, isVideo: call.isVideo });
  await supabase.rpc("increment_unread", { conv_id: conversationId, preview: `📞 ${label}` });
  await notifyMissedCall(supabase, { workspaceId: channel.workspace_id, conversationId, contactId: contact.contactId, label });
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
    // Varios numeros: el canal pasa a llamarse por su numero ("WhatsApp +54..."). Nunca lanza.
    const config = await getEvolutionConfig(supabase, channel.workspace_id);
    if (config) await refreshWhatsappIdentity(supabase, config, channel);
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
  } else if (state === "refused") {
    // Evolution corta despues de N codigos QR sin escanear y avisa con "refused". Sin esto el canal quedaba
    // "Conectando" para siempre, y la unica salida es generar un QR nuevo.
    await supabase
      .from("channels")
      .update({
        connection_status: "disconnected",
        last_error: "El código QR venció sin escanearse. Tocá Reconectar para generar uno nuevo.",
      })
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
  sender: WhatsappSender,
) {
  const data = payload.data;
  const messageId = data?.key?.id ?? null;
  const fromMe = data?.key?.fromMe === true;

  const text = extractText(data?.message);

  // Los adjuntos, normalizados y todavia sin archivo (F1, F4). WhatsApp manda
  // la media cifrada, asi que aca solo salen los metadatos: el archivo se le
  // pide a Evolution mas abajo.
  const attachments = describeWhatsappMessage(data?.message);
  const attachmentsColumn = toAttachmentsColumn(attachments);

  const preview =
    previewForMessage({ text, attachments: attachmentsColumn }) ||
    describeAttachment(data?.messageType) ||
    "";
  const at = messageTimestamp(data?.messageTimestamp);

  const contact = await upsertContactForSender({
    supabase,
    channel,
    // El telefono o, si WhatsApp no lo comparte, el @lid: es la identidad de esta
    // persona en el canal y a donde se le contesta.
    senderId: sender.id,
    // Si el mensaje salio de nuestro telefono, pushName es nuestro nombre, no
    // el del lead: se usa el numero antes que ensuciar la ficha. Sin numero (un
    // @lid), un nombre generico que la persona puede cambiar.
    senderName: (!fromMe && data?.pushName) || sender.phone || UNKNOWN_WHATSAPP_NAME,
    senderUsername: sender.phone,
    senderPicture: null,
    // El telefono es la clave fuerte de deduplicacion: si este lead ya escribio
    // por Instagram y alguien le cargo el numero, se vincula al mismo contacto
    // en vez de crear uno nuevo (find_or_link_contact, migracion 00025). Con un
    // @lid no hay telefono: el contacto se identifica por el canal.
    senderPhone: sender.phone,
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
  // El adjunto se guarda SIEMPRE que haya uno, con o sin caption (F4). Hasta
  // ahora era `attachments: text ? null : data.message`, y como `extractText`
  // devuelve el `caption` de una imagen, **una foto con texto se guardaba sin
  // la foto**: la media se perdia sin que nada lo indicara.
  // Extra I, F35: la respuesta a un DM de una automatización con pieza la hereda. Se resuelve ANTES de guardar para
  // que `origin_context` quede completo; no lanza.
  const baseOrigin = fromMe ? null : buildOriginContext({ platform: channel.platform, baileysMessage: data?.message ?? null });
  const extras = fromMe
    ? { storyPiece: null, inherited: null }
    : await resolveInboundOriginExtras(supabase, {
        workspaceId: channel.workspace_id,
        conversationId: conversation.id,
        platform: channel.platform,
        storyId: null,
        baseOriginContext: baseOrigin,
      });
  const inserted = await insertMessage({
    supabase,
    conversationId: conversation.id,
    direction: fromMe ? "outbound" : "inbound",
    text,
    platformMessageId: messageId,
    attachments: attachmentsColumn,
    createdAt: at,
    workspaceId: channel.workspace_id,
    // El eco de un envío desde el teléfono es un saliente externo (F2). Si el
    // insert propio ya guardó este id, el índice único lo descarta.
    origin: fromMe ? "external" : null,
    // De donde vino un ENTRANTE: el anuncio de "clic a WhatsApp" (`externalAdReply`) y el mensaje citado.
    // Lista blanca; guardarlo nunca frena el mensaje (Extra L, F19).
    originContext: fromMe ? null : buildOriginContext({ platform: channel.platform, baileysMessage: data?.message ?? null, content: inheritedContentContext(extras.inherited) }),
  });

  // ── El toque de atribución (F85) ──────────────────────────────────────────
  // Solo los ENTRANTES: lo que sale desde el teléfono no es el lead escribiendo.
  // Va después de guardar el mensaje y no puede tumbar el webhook: la función
  // atrapa todo. Si el mensaje vino de un anuncio de "clic a WhatsApp", los
  // datos están en `contextInfo.externalAdReply` del mensaje crudo de Baileys.
  if (!fromMe) {
    try {
      await recordInboundTouch(supabase, {
        workspaceId: channel.workspace_id,
        contactId: contact.contactId,
        conversationId: conversation.id,
        platform: channel.platform,
        contactExisted: contact.existed,
        messageAt: new Date(at),
        platformMessageId: messageId,
        messageId: inserted.id ?? null,
        referral: fromBaileysMessage(data?.message),
        inherited: extras.inherited,
        account: touchAccountOf(channel),
      });
    } catch (err) {
      // Cinturón de seguridad: la función ya atrapa todo, pero el lead no se
      // queda sin su flow por una estadística.
      console.error("[evolution] el toque de atribución falló:", err instanceof Error ? err.message : err);
    }
  }

  // ── La media, adentro (F4) ────────────────────────────────────────────────
  // WhatsApp borra la media de su servidor pasado un tiempo, asi que se pide
  // ahora y no en la cola. Va en el after() que ya respondio 200, y
  // storeEvolutionMedia nunca lanza: un archivo que no se pudo traer queda con
  // su motivo en la burbuja.
  if (inserted.stored && inserted.id && hasDownloadableMedia(attachments)) {
    const config = await getEvolutionConfig(supabase, channel.workspace_id);
    if (config && channel.evolution_instance) {
      const media = await storeEvolutionMedia({
        supabase,
        config,
        instance: channel.evolution_instance,
        workspaceId: channel.workspace_id,
        conversationId: conversation.id,
        messageId: inserted.id,
        // El objeto completo, no solo el id (F4, §14c): con el objeto entero
        // Evolution lo usa directo; con la clave sola busca en su propia base.
        rawMessage: data?.message ?? null,
        items: attachments,
      });

      // Con el archivo adentro: transcribir la nota de voz o encolar la
      // descripcion de la imagen (F7, F8). Va ANTES de agendar el turno del
      // agente: asi el turno arranca con la transcripcion ya hecha.
      await afterMediaStored({ supabase, messageId: inserted.id, items: media.items });

      // Un sticker que mandamos nosotros (desde el celular o desde aca) entra
      // solo a la biblioteca (00257): WhatsApp no deja leer los guardados en el
      // telefono, asi que la biblioteca se arma con el uso. Nunca lanza.
      if (fromMe) {
        for (const item of media.items) {
          if (item.kind === "sticker" && item.storagePath) {
            await collectSentSticker(supabase, { workspaceId: channel.workspace_id, storagePath: item.storagePath });
          }
        }
      }
    } else {
      console.error("[evolution] sin configuracion o sin instancia: no puedo traer la media");
    }
  }

  // Modo borrador (Bloque 2c). Un mensaje del lead deja viejo al borrador
  // pendiente (se reemplaza); uno que la operadora mando desde el celular es
  // una respuesta real por otro lado (se descarta): aprobar despues el
  // borrador le mandaria al lead dos respuestas.
  if (fromMe) {
    await discardPendingDrafts(supabase, conversation.id, { reason: AUTO_DISCARD.answeredElsewhere, decidedBy: null });
  } else {
    await supersedePendingDrafts(supabase, conversation.id);
  }

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

  const automation = await runInboundAutomation({
    supabase,
    channel,
    contactId: contact.contactId,
    conversationId: conversation.id,
    isAutomationPaused: conversation.isAutomationPaused,
    isFirstMessage: !contact.existed,
    incomingMessage: {
      text: text || undefined,
      sender: { id: sender.id, name: data?.pushName || undefined },
      // El anuncio de "clic a WhatsApp", para el filtro «Solo si vino de un anuncio» y {{message_origin.*}}.
      ...(adOriginOfBaileys(data?.message) ?? {}),
    },
  });

  // ── Agente de IA (Fase 3) ─────────────────────────────────────────────────
  // Despues de las automatizaciones, nunca antes: si un flow reclamo el
  // mensaje, el agente se abstiene y lo deja registrado. Es el unico lugar que
  // agenda un turno del agente.
  await maybeScheduleAgentTurn(supabase, {
    workspaceId: channel.workspace_id,
    channelId: channel.id,
    contactId: contact.contactId,
    conversationId: conversation.id,
    automation,
  });

  // ── Foto de perfil (F16) ──────────────────────────────────────────────────
  // Va AL FINAL, despues del turno del agente: es cosmetico, no algo de lo
  // que el agente dependa. resolveSourceUrl solo pega contra Evolution si
  // maybeStoreContactAvatar decide que hace falta -- nunca en cada mensaje.
  if (channel.evolution_instance) {
    const config = await getEvolutionConfig(supabase, channel.workspace_id);
    if (config) {
      const instance = channel.evolution_instance;
      await maybeStoreContactAvatar({
        supabase,
        workspaceId: channel.workspace_id,
        contactId: contact.contactId,
        resolveSourceUrl: () => fetchProfilePictureUrl(config, instance, sender.id),
      });
    }
  }
}

/** El nombre de un contacto de WhatsApp del que no sabemos ni el nombre ni el numero. */
const UNKNOWN_WHATSAPP_NAME = "Contacto de WhatsApp";

/**
 * Si la persona ya entro antes SOLO con su @lid (sin telefono) y ahora llega con
 * los dos, se sigue usando el @lid como identidad: asi el mensaje cae en el mismo
 * contacto y la misma conversacion, y el telefono se le suma a la ficha
 * (find_or_link_contact completa los datos de un remitente conocido). Si no, el
 * telefono, como siempre. Nunca lanza: ante un error, la identidad de siempre.
 */
async function withKnownLid(supabase: Db, channel: ChannelRow, sender: WhatsappSender): Promise<WhatsappSender> {
  if (!sender.phone || !sender.lid || sender.id === sender.lid) return sender;
  try {
    const { data } = await supabase
      .from("contact_channels")
      .select("contact_id")
      .eq("channel_id", channel.id)
      .eq("platform_sender_id", sender.lid)
      .maybeSingle();
    return data ? { ...sender, id: sender.lid } : sender;
  } catch (err) {
    console.error("[evolution] no pude buscar el @lid conocido:", err instanceof Error ? err.message : err);
    return sender;
  }
}
