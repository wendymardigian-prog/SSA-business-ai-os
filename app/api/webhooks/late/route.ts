/**
 * Receptor de los webhooks de Zernio (Instagram: DMs, story replies y comentarios).
 *
 * Es el unico receptor del sistema junto con /api/webhooks/evolution. Vive en la
 * app y no en una Edge Function porque el motor de flows, las secuencias y (en
 * Fase 3) el agente de IA corren en Node: desde Deno no se pueden llamar.
 *
 * Desde la Fase 3 los mensajes entrantes SI se guardan en la tabla local, ademas
 * del contacto y la conversacion. Es un dual-write: la bandeja sigue pidiendole
 * el hilo a Zernio por API (ver app/api/v1/messages), y lo que cambio es que
 * tambien se guarda una copia, porque el agente de IA lee el historial de la
 * base y los dashboards se arman sobre la tabla local.
 *
 * El guardado es siempre: ya no hay interruptor (ver persistInboundMessage en
 * lib/inbound.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveWebhookSecret, verifyWebhookSignature } from "@/lib/zernio-webhook";
import { upsertContactForSender } from "@/lib/inbox-sync";
import { accountLabel, touchAccountOf } from "@/lib/inbox/accounts";
import { fromZernioReferral, recordInboundTouch } from "@/lib/contacts/touch-inbound";
import { adOriginOf, buildOriginContext } from "@/lib/messages/origin-context";
import { inheritedContentContext, resolveInboundOriginExtras } from "@/lib/attribution/inbound-origin";
import { resolveContentForIncoming } from "@/lib/attribution/content-variables";
import { maybeEnqueueAdOriginLookup } from "@/lib/meta/zernio-ad-origin";
import { attributeComment } from "@/lib/comments/attribution";
import { processComment } from "@/lib/comment-processor";
import type { Database } from "@/lib/types/database";
import { messagePreview, previewForMessage } from "@/lib/message-preview";
import {
  fromZernioAttachments,
  hasDownloadableMedia,
  sharedPostsInText,
  storyReplyAttachment,
  toAttachmentsColumn,
} from "@/lib/messages/attachments";
import { storeInboundMedia } from "@/lib/inbound-media";
import { afterMediaStored } from "@/lib/chat-media/after-stored";
import {
  applyOptOut,
  pauseSequencesOnReply,
  claimWebhookEvent,
  persistInboundMessage,
  runInboundAutomation,
  upsertConversation,
  handleMessageSentEcho,
} from "@/lib/inbound";
import { maybeScheduleAgentTurn } from "@/lib/agent/dispatch";
import { maybeStoreContactAvatar } from "@/lib/contacts/avatar";
import { fromZernioPlatformEvent, settlePublication } from "@/lib/publishing/inbound";
import { isOwnComment, storeComment } from "@/lib/comments/store";
import type { SocialPlatform } from "@/lib/types/database";
import { supersedePendingDrafts } from "@/lib/agent/drafts/lifecycle";
import { handleZernioReaction, parseZernioReaction } from "@/lib/messages/reactions-inbound";
import {
  findWorkspaceForSignedEvent,
  isAccountEvent,
  parseAccountEvent,
  refreshZernioAccounts,
} from "@/lib/channels/zernio-account-events";

// ── Zernio API webhook payload ───────────────────────────────────────────────

interface WebhookPayload {
  id?: string;
  event: string;
  message: {
    id: string;
    conversationId: string;
    platform: string;
    platformMessageId: string;
    direction: string;
    text: string | null;
    attachments: Array<{ type: string; originalType?: string; url: string; payload?: unknown }>;
    sender: {
      id: string;
      name: string;
      username: string | null;
      picture: string | null;
    };
    sentAt: string;
    isRead: boolean;
  };
  conversation: {
    id: string;
    platformConversationId: string | null;
    participantId: string;
    participantName: string;
    participantUsername: string | null;
    participantPicture: string | null;
    status: string;
  };
  account: {
    id: string;
    platform: string;
    username: string;
    displayName: string;
  };
  metadata?: {
    quickReplyPayload?: string;
    callbackData?: string;
    postbackPayload?: string;
    postbackTitle?: string;
    /**
     * Instagram: viene cuando el mensaje es una respuesta a una historia de la
     * cuenta. Lo usa el filtro "es respuesta a historia" del trigger de
     * palabra clave (F6).
     */
    storyReply?: { storyId: string; storyUrl?: string };
    /**
     * Instagram: alguien mencionó la cuenta en SU historia (`@cuenta`). Excluyente con `storyReply`.
     * Zernio lo manda en `metadata.isStoryMention` (SDK 0.2.519). Es un origen aparte: toque `story_mention`.
     */
    isStoryMention?: boolean;
    /**
     * Datos del anuncio que originó la conversación. Solo viene en el PRIMER
     * mensaje después del clic (ad_id y ref en Instagram y Messenger; ctwa_clid
     * y source_id en WhatsApp). La forma esta en `ZernioReferral` (SDK 0.2.519),
     * pero ningún campo es seguro: `fromZernioReferral` lo lee de forma
     * defensiva (F85) y `messages.origin_context` guarda solo una lista blanca (F19).
     */
    referral?: ZernioReferral | null;
  };
  timestamp: string;
}

/**
 * El `metadata.referral` del webhook de mensajes de Zernio, como lo tipa el SDK (0.2.519). Solo documenta:
 * se lee con `fromZernioReferral` (defensivo) y `buildOriginContext` (lista blanca).
 */
interface ZernioReferral {
  ctwa_clid?: string;
  source_id?: string;
  source_type?: string;
  source_url?: string;
  headline?: string;
  body?: string;
  media_type?: string;
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  ad_id?: string;
  ref?: string;
  source?: string;
  /** En Instagram es `OPEN_THREAD`: no dice nada del anuncio. */
  type?: string;
  ads_context_data?: { ad_title?: string; photo_url?: string; video_url?: string; post_id?: string; product_id?: string; flow_id?: string };
}

interface CommentWebhookPayload {
  id?: string;
  event: string;
  comment: {
    id: string;
    /** Zernio post ID; null when the comment is on a post not published through Zernio. */
    postId: string | null;
    platformPostId: string;
    platform: string;
    text: string;
    author: { id: string; username?: string; name?: string; picture?: string };
    createdAt: string;
    isReply: boolean;
    parentCommentId: string | null;
    /** Solo viene cuando el comentario es sobre un anuncio (contenido pago): `ad.id` es el id del anuncio en Meta (Instagram). */
    ad?: { id?: string; title?: string; promotionStatus?: string };
  };
  post: { id: string; platformPostId: string };
  account: { id: string; platform: string; username: string };
  timestamp: string;
}

// ── Webhook handler ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    return await handleWebhook(request);
  } catch (err) {
    console.error("Webhook handler error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

async function handleWebhook(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-late-signature");
  const headerEventId = request.headers.get("x-late-event-id");

  let parsed: { event?: string; id?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventId = parsed.id || headerEventId;

  // Resultado de una publicacion nuestra (F35). Es el camino rapido: la
  // revision periodica cubre el caso de que el aviso no llegue.
  if (parsed.event?.startsWith("post.platform.")) {
    return handlePostPlatformWebhook(parsed, body, signature, eventId);
  }

  if (parsed.event === "comment.received") {
    return handleCommentWebhook(parsed as CommentWebhookPayload, body, signature, eventId);
  }

  // Eco de un saliente externo (respuesta desde la app de Instagram, ManyChat,
  // WhatsApp Business): se guarda como `external` para que el dashboard lo vea
  // y la verificación del Bloque 2 lo tenga en cuenta (F2).
  if (parsed.event === "message.sent") {
    return handleMessageSentWebhook(parsed as MessageSentPayload, body, signature, eventId);
  }

  // Una reaccion del contacto (A3): se guarda aparte, no es un mensaje.
  if (parsed.event === "reaction.received") {
    return handleReactionWebhook(parsed as ReactionWebhookPayload, body, signature, eventId);
  }

  // Una cuenta conectada o desconectada en Zernio: se vuelven a armar los canales
  // y las cuentas sociales del negocio.
  if (isAccountEvent(parsed.event)) {
    return handleAccountWebhook(parsed, body, signature, eventId);
  }

  // Everything else besides message.received is acknowledged and ignored
  if (parsed.event !== "message.received") {
    return NextResponse.json({ ok: true, skipped: parsed.event ?? "sin evento" });
  }

  const payload = parsed as WebhookPayload;

  const { message: msg, account } = payload;

  // Ignore outbound messages to prevent loops. El SDK dice la dirección como
  // 'incoming' | 'outgoing'; el saliente llega por message.sent, no por acá.
  if (msg.direction === "outgoing" || msg.direction === "outbound") {
    return NextResponse.json({ ok: true, skipped: "mensaje saliente" });
  }

  const supabase = await createServiceClient();

  // Look up channel by late_account_id
  const { data: channel } = await supabase
    .from("channels")
    .select("*")
    .eq("late_account_id", account.id)
    .eq("is_active", true)
    .single();

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  // Prevent loops: if the sender is another connected account in this
  // workspace, skip. This happens when both sides of a DM conversation
  // are connected (e.g. during testing).
  if (msg.sender.username) {
    const { data: senderChannel } = await supabase
      .from("channels")
      .select("id")
      .eq("workspace_id", channel.workspace_id)
      .eq("username", msg.sender.username)
      .eq("is_active", true)
      .maybeSingle();

    if (senderChannel) {
      return NextResponse.json({ ok: true, skipped: "el remitente es una cuenta propia" });
    }
  }

  // Firma HMAC-SHA256 contra el secreto del workspace (con fallback al viejo
  // secreto por canal). Sin secreto no se puede verificar nada, y esta URL es
  // publica: se rechaza en vez de aceptar a ciegas.
  const secret = await resolveWebhookSecret(supabase, channel);
  if (!secret) {
    console.error(
      `[webhook] el workspace ${channel.workspace_id} no tiene el secreto en Vault; no puedo validar la firma`
    );
    return NextResponse.json({ error: "Webhook sin secreto configurado" }, { status: 401 });
  }
  if (!verifyWebhookSignature(secret, body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!(await claimWebhookEvent(supabase, eventId))) {
    return NextResponse.json({ ok: true, skipped: "evento repetido" });
  }

  // Se responde 200 y se procesa despues: Zernio corta la entrega a los 5s y
  // reintenta, asi que resolver el contacto y correr el flow (que manda mensajes
  // y puede llamar a un modelo de IA) nunca puede pasar antes de contestar.
  after(async () => {
    try {
      await processMessageEvent(supabase, payload, channel);
    } catch (err) {
      console.error("Webhook message processing error:", err);
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}

async function processMessageEvent(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  payload: WebhookPayload,
  channel: Database["public"]["Tables"]["channels"]["Row"],
) {
  const { message: msg, conversation: conv, account, metadata } = payload;

  // ── Upsert contact ───────────────────────────────────────────────────────

  const senderId = msg.sender.id;
  const senderName = msg.sender.name || msg.sender.username || senderId;

  const contact = await upsertContactForSender({
    supabase,
    channel,
    senderId,
    senderName,
    senderPicture: msg.sender.picture || null,
    senderUsername: msg.sender.username || null,
    interactionAt: new Date().toISOString(),
  });

  if (!contact) {
    console.error("Failed to create contact for webhook message");
    return;
  }

  const contactId = contact.contactId;

  // ── Upsert conversation ──────────────────────────────────────────────────

  // Los adjuntos, normalizados y todavia sin archivo (F1, F3). Se arman antes
  // del preview porque el preview los usa: un DM que es solo una nota de voz
  // dejaba la fila de la lista en blanco.
  //
  // Se suman dos cosas que hoy se descartan: la respuesta a una historia (que
  // solo llegaba a las automatizaciones) y los links a posts de Instagram que
  // vienen en el texto, que quedaban como una URL pelada.
  const attachments = [
    ...fromZernioAttachments(msg.attachments),
    ...(storyReplyAttachment(metadata?.storyReply) ? [storyReplyAttachment(metadata?.storyReply)!] : []),
    ...sharedPostsInText(msg.text),
  ];

  const preview = previewForMessage({ text: msg.text, attachments: toAttachmentsColumn(attachments) });

  const conversation = await upsertConversation({
    supabase,
    channel,
    contactId,
    externalConversationId: conv.id,
    preview,
    at: new Date().toISOString(),
    incrementUnread: true,
  });

  if (!conversation) return;

  // ── La pieza de la historia y la herencia de una automatización (Extra I, F33 y F35) ──
  // Se resuelve ANTES de guardar para que `origin_context` quede completo en el mismo insert. No lanza: si falla, el
  // mensaje se guarda como siempre.
  const baseOrigin = buildOriginContext({
    platform: channel.platform,
    storyReply: metadata?.storyReply ?? null,
    isStoryMention: metadata?.isStoryMention ?? null,
    zernioReferral: metadata?.referral ?? null,
  });
  const extras = await resolveInboundOriginExtras(supabase, {
    workspaceId: channel.workspace_id,
    conversationId: conversation.id,
    platform: channel.platform,
    storyId: metadata?.storyReply?.storyId ?? null,
    baseOriginContext: baseOrigin,
  });

  // ── Guardado del mensaje (F19) ───────────────────────────────────────────
  // Va antes de las automatizaciones para que el agente de la Fase 3 y el nodo
  // AI Response encuentren el mensaje al armar el historial: si se guardara
  // despues, el turno que lo disparo seria el unico que no lo ve.
  //
  // Se guardan los DOS ids del mensaje, en columnas distintas:
  //
  //   - platform_message_id lleva el de ZERNIO (msg.id). Es el que deduplica:
  //     el mismo espacio de ids que usa recordSend al enviar y el unico que
  //     devuelve el endpoint de historial, asi que el indice unico funciona.
  //   - platform_native_message_id lleva el de Meta (msg.platformMessageId).
  //     No lo usa nada del sistema, pero es el unico handle para un pedido de
  //     borrado o un reclamo de soporte contra Meta, y el endpoint de historial
  //     no lo devuelve: si no se guarda ahora, se pierde para siempre.
  //
  // Los adjuntos entran en `pending`: la burbuja muestra "Descargando
  // adjunto…" y el archivo se copia a nuestro Storage unas lineas mas abajo.
  const inserted = await persistInboundMessage({
    supabase,
    channel,
    conversationId: conversation.id,
    text: msg.text ?? null,
    platformMessageId: msg.id ?? null,
    platformNativeMessageId: msg.platformMessageId ?? null,
    attachments: toAttachmentsColumn(attachments),
    createdAt: msg.sentAt || new Date().toISOString(),
    quickReplyPayload: metadata?.quickReplyPayload ?? null,
    postbackPayload: metadata?.postbackPayload ?? null,
    callbackData: metadata?.callbackData ?? null,
    // De donde vino (historia, mencion, anuncio): lista blanca. Guardarlo nunca frena el mensaje.
    originContext: buildOriginContext({
      platform: channel.platform,
      storyReply: metadata?.storyReply
        ? { ...metadata.storyReply, socialPostId: extras.storyPiece?.socialPostId, contentPostId: extras.storyPiece?.contentPostId }
        : null,
      isStoryMention: metadata?.isStoryMention ?? null,
      zernioReferral: metadata?.referral ?? null,
      content: inheritedContentContext(extras.inherited),
    }),
  });

  // ── El toque de atribución (F85) ──────────────────────────────────────────
  // DESPUÉS de guardar el mensaje y ANTES del opt-out: el lead escribió aunque
  // después pida que no lo contacten. Nunca puede tumbar la recepción:
  // `recordInboundTouch` atrapa todo y el mensaje ya está guardado. Solo anota
  // lo que suma información (primer mensaje, historia, anuncio, una vuelta).
  try {
    await recordInboundTouch(supabase, {
      workspaceId: channel.workspace_id,
      contactId,
      conversationId: conversation.id,
      platform: channel.platform,
      contactExisted: contact.existed,
      messageAt: new Date(msg.sentAt || Date.now()),
      platformMessageId: msg.id ?? null,
      messageId: inserted.id ?? null,
      storyId: metadata?.storyReply?.storyId ?? null,
      isStoryMention: metadata?.isStoryMention === true,
      referral: fromZernioReferral(metadata?.referral),
      storyPiece: extras.storyPiece,
      inherited: extras.inherited,
      account: touchAccountOf(channel),
    });
  } catch (err) {
    // `recordInboundTouch` ya atrapa todo; esto es el cinturón de seguridad. Si
    // algo se escapara, el lead no se queda sin su flow por una estadística.
    console.error("[webhook] el toque de atribución falló:", err instanceof Error ? err.message : err);
  }

  // ── El anuncio de origen, si el mensaje no lo trajo (Tirón 2, A1) ─────────
  // Meta manda el anuncio solo en el primer mensaje después del clic; si llegó sin él, se le pregunta a Zernio UNA vez por
  // conversación (job con reintentos). Solo Instagram. No lanza: el mensaje y el toque ya están guardados.
  await maybeEnqueueAdOriginLookup(supabase, {
    workspaceId: channel.workspace_id,
    contactId,
    conversationId: conversation.id,
    channelId: channel.id,
    lateConversationId: conv.id,
    lateAccountId: account.id,
    messageId: inserted.id ?? null,
    platformMessageId: msg.id ?? null,
    messageAt: new Date(msg.sentAt || Date.now()).toISOString(),
    platform: channel.platform,
    hasReferral: fromZernioReferral(metadata?.referral) !== null,
  });

  // ── La media, adentro (F3) ────────────────────────────────────────────────
  // Va aca, dentro del after() que ya existe, y no en la cola: la URL del CDN
  // de Meta VENCE. Si se esperara al cron del minuto, a veces se llega tarde y
  // despues no hay nada que escuchar ni que transcribir.
  //
  // Nunca puede voltear el webhook: storeInboundMedia atrapa todo y deja el
  // motivo en el adjunto.
  if (inserted.id && hasDownloadableMedia(attachments)) {
    const media = await storeInboundMedia({
      supabase,
      workspaceId: channel.workspace_id,
      conversationId: conversation.id,
      messageId: inserted.id,
      items: attachments,
    });

    // Con el archivo adentro: transcribir el audio o encolar la descripcion de
    // la imagen (F7, F8). Va ANTES de agendar el turno del agente, que esta mas
    // abajo: asi el turno arranca con la transcripcion ya hecha y la compuerta
    // de interpretabilidad no tiene que esperar.
    await afterMediaStored({ supabase, messageId: inserted.id, items: media.items });
  }

  // ── Modo borrador (Bloque 2c) ─────────────────────────────────────────────
  // El lead escribio antes de que alguien aprobara: el borrador pendiente quedo
  // viejo. Se marca reemplazado ANTES de las automatizaciones y del agente, sin
  // importar si el agente esta prendido: aprobarlo mandaria una respuesta que
  // ignora lo ultimo que dijo. El turno de este mensaje genera otro.
  await supersedePendingDrafts(supabase, conversation.id);

  // ── Auto-pausa de secuencias (F11) ────────────────────────────────────────
  // El lead contesto: el seguimiento automatico de este canal se frena. Va
  // antes que todo lo demas y fuera de runInboundAutomation a proposito —
  // aquella corta cuando alguien tomo la conversacion a mano o cuando una
  // palabra clave global consume el mensaje, y en los dos casos el lead igual
  // respondio. Frenar el drip es un reflejo sobre el hecho de que contesto, no
  // una automatizacion mas.

  await pauseSequencesOnReply({ supabase, contactId, channelId: channel.id });

  // ── Marca "no contactar" (F18) ───────────────────────────────────────────
  // Va ANTES de las automatizaciones a proposito: si el lead acaba de pedir que
  // dejen de escribirle, no se le dispara un flow que le conteste.

  const optOut = await applyOptOut({
    supabase,
    contactId,
    conversationId: conversation.id,
    text: msg.text ?? null,
  });
  if (optOut.matched) return;

  // ── Automatizaciones ──────────────────────────────────────────────────────

  // La pieza de la que vino el mensaje, para `{{content.title}}` (Extra I, F34). No lanza.
  const incomingContent = await resolveContentForIncoming(supabase, {
    workspaceId: channel.workspace_id,
    storyPiece: extras.storyPiece,
    inherited: extras.inherited,
    adId: adOriginOf(metadata?.referral)?.adId,
  });

  const automation = await runInboundAutomation({
    supabase,
    channel,
    contactId,
    conversationId: conversation.id,
    isAutomationPaused: conversation.isAutomationPaused,
    isFirstMessage: !contact.existed,
    incomingMessage: {
      text: msg.text || undefined,
      postbackPayload: metadata?.postbackPayload || undefined,
      quickReplyPayload: metadata?.quickReplyPayload || undefined,
      callbackData: metadata?.callbackData || undefined,
      isStoryReply: Boolean(metadata?.storyReply),
      storyId: metadata?.storyReply?.storyId,
      // El origen que leen los filtros "solo si vino de un anuncio" y "solo menciones en historias".
      isStoryMention: metadata?.isStoryMention === true,
      ...(adOriginOf(metadata?.referral) ?? {}),
      ...(incomingContent ? { content: incomingContent } : {}),
      sender: {
        id: msg.sender.id,
        name: msg.sender.name,
        username: msg.sender.username || undefined,
      },
    },
    lateConversationId: conv.id,
    lateAccountId: account.id,
  });

  // ── Agente de IA (Fase 3) ─────────────────────────────────────────────────
  // Despues de las automatizaciones, nunca antes: si un flow reclamo el
  // mensaje, el agente se abstiene y lo deja registrado. Es el unico lugar que
  // agenda un turno del agente.
  await maybeScheduleAgentTurn(supabase, {
    workspaceId: channel.workspace_id,
    channelId: channel.id,
    contactId: contactId,
    conversationId: conversation.id,
    automation,
  });

  // ── Foto de perfil (F16) ──────────────────────────────────────────────────
  // Va AL FINAL, despues del turno del agente: es cosmetico, no algo de lo
  // que el agente dependa, y no tiene que demorar la respuesta. Nunca lanza.
  await maybeStoreContactAvatar({
    supabase,
    workspaceId: channel.workspace_id,
    contactId,
    resolveSourceUrl: () => msg.sender.picture || null,
  });
}

// ── Comment webhook ─────────────────────────────────────────────────────────

interface MessageSentPayload {
  id?: string;
  event: "message.sent";
  message: {
    id: string;
    conversationId: string;
    platform: string;
    platformMessageId: string;
    direction: string;
    text: string | null;
    attachments?: Array<{ type: string; originalType?: string; url: string; payload?: unknown }>;
    sentAt?: string;
  };
  account: { id: string };
}

/**
 * Eco de un saliente externo (`message.sent`). Mismo esqueleto que los otros
 * receptores: encuentra el canal, valida la firma, deduplica el evento y guarda
 * en `after()`. Guardar el mensaje no puede voltear el webhook.
 */
async function handleMessageSentWebhook(
  payload: MessageSentPayload,
  rawBody: string,
  signature: string | null,
  eventId: string | null | undefined
) {
  const supabase = await createServiceClient();

  const { data: channel } = await supabase
    .from("channels")
    .select("id, workspace_id")
    .eq("late_account_id", payload.account.id)
    .eq("is_active", true)
    .single();

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const secret = await resolveWebhookSecret(supabase, channel);
  if (!secret) {
    console.error(
      `[webhook] el workspace ${channel.workspace_id} no tiene el secreto en Vault; no puedo validar la firma`
    );
    return NextResponse.json({ error: "Webhook sin secreto configurado" }, { status: 401 });
  }
  if (!verifyWebhookSignature(secret, rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!(await claimWebhookEvent(supabase, eventId))) {
    return NextResponse.json({ ok: true, skipped: "evento repetido" });
  }

  after(async () => {
    try {
      const echo = await handleMessageSentEcho({
        supabase,
        channel: { id: channel.id, workspace_id: channel.workspace_id },
        message: payload.message,
      });

      // El mismo helper que los entrantes (F3): un audio que la operadora mando
      // desde la app de Instagram tambien se copia a nuestro Storage.
      const echoItems = echo.items ?? [];
      if (echo.stored && echo.messageId && echo.conversationId && hasDownloadableMedia(echoItems)) {
        await storeInboundMedia({
          supabase,
          workspaceId: channel.workspace_id,
          conversationId: echo.conversationId,
          messageId: echo.messageId,
          items: echoItems,
        });
      }
    } catch (err) {
      console.error("Webhook message.sent processing error:", err);
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}

interface ReactionWebhookPayload {
  id?: string;
  event: "reaction.received";
  reaction?: unknown;
  conversation?: { id?: string };
  account: { id: string };
}

/**
 * Una reaccion que avisa Zernio (`reaction.received`, A3). Mismo esqueleto que
 * los otros receptores: encuentra el canal, valida la firma, deduplica y guarda
 * en `after()`. No toca contactos, conversaciones ni automatizaciones.
 */
async function handleReactionWebhook(
  payload: ReactionWebhookPayload,
  rawBody: string,
  signature: string | null,
  eventId: string | null | undefined
) {
  const supabase = await createServiceClient();

  const { data: channel } = await supabase
    .from("channels")
    .select("id, workspace_id")
    .eq("late_account_id", payload.account?.id ?? "")
    .eq("is_active", true)
    .maybeSingle();
  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const secret = await resolveWebhookSecret(supabase, channel);
  if (!secret) {
    console.error(
      `[webhook] el workspace ${channel.workspace_id} no tiene el secreto en Vault; no puedo validar la firma`
    );
    return NextResponse.json({ error: "Webhook sin secreto configurado" }, { status: 401 });
  }
  if (!verifyWebhookSignature(secret, rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!(await claimWebhookEvent(supabase, eventId))) {
    return NextResponse.json({ ok: true, skipped: "evento repetido" });
  }

  const reaction = parseZernioReaction(payload);
  const lateConversationId = payload.conversation?.id;
  if (!reaction || !lateConversationId) {
    return NextResponse.json({ ok: true, skipped: "reaccion sin mensaje o conversacion" });
  }

  after(async () => {
    await handleZernioReaction(supabase, channel, { lateConversationId, reaction });
  });

  return NextResponse.json({ ok: true, queued: true });
}

async function handleCommentWebhook(
  payload: CommentWebhookPayload,
  rawBody: string,
  signature: string | null,
  eventId: string | null | undefined
) {
  const supabase = await createServiceClient();

  const { data: channel } = await supabase
    .from("channels")
    .select("*")
    .eq("late_account_id", payload.account.id)
    .eq("is_active", true)
    .single();

  // De que red es el comentario. Zernio lo manda en `account.platform`,
  // pero si faltara, el canal lo sabe: sin esto el comentario se pierde
  // entero, porque `social_post_comments.platform` es NOT NULL. Lo encontro
  // scripts/verify-webhook.mjs.
  const platform = (payload.account.platform ??
    payload.comment.platform ??
    channel?.platform) as SocialPlatform | undefined;

  // La cuenta tambien puede ser una que NO conversa: TikTok no tiene API de
  // mensajes, asi que no tiene canal: por eso se busca ademas en
  // social_accounts, que es donde viven las cuentas de publicacion y metricas.
  // Varias cuentas de la misma red (00236): se busca la cuenta POR SU ID en Zernio, que es la del canal. Para que un
  // workspace con una sola cuenta siga igual, si no hay coincidencia exacta se cae a "la de esa red" (la mas antigua).
  const exactAccount = channel && platform
    ? await supabase
        .from("social_accounts")
        .select("id, workspace_id, platform, username, external_id")
        .eq("workspace_id", channel.workspace_id)
        .eq("platform", platform)
        .eq("external_id", payload.account.id)
        .maybeSingle()
    : null;
  const { data: socialAccount } = channel && platform
    ? exactAccount?.data
      ? exactAccount
      : await supabase
          .from("social_accounts")
          .select("id, workspace_id, platform, username, external_id")
          .eq("workspace_id", channel.workspace_id)
          .eq("platform", platform)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle()
    : await supabase
        .from("social_accounts")
        .select("id, workspace_id, platform, username, external_id")
        .eq("external_id", payload.account.id)
        .maybeSingle();

  if (!channel && !socialAccount) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const workspaceId = channel?.workspace_id ?? socialAccount!.workspace_id;

  // Un comentario nuestro (la respuesta publica del flow, o una a mano) SI se
  // guarda: el hilo tiene que leerse completo. Lo que no hace es disparar
  // automatizaciones, que seria un bot contestandose solo.
  const own = isOwnComment(payload.comment.author, {
    username: channel?.username ?? socialAccount?.username ?? null,
    externalId: socialAccount?.external_id ?? payload.account.id,
  });

  // El secreto es del workspace: sin canal (TikTok) se busca igual, con la
  // columna del canal en null.
  const secret = await resolveWebhookSecret(
    supabase,
    channel ?? { workspace_id: workspaceId, webhook_secret: null },
  );
  if (!secret) {
    console.error(
      `[webhook] el workspace ${workspaceId} no tiene webhook_secret; no puedo validar la firma`
    );
    return NextResponse.json({ error: "Webhook sin secreto configurado" }, { status: 401 });
  }
  if (!verifyWebhookSignature(secret, rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!(await claimWebhookEvent(supabase, eventId))) {
    return NextResponse.json({ ok: true, skipped: "evento repetido" });
  }

  let commentedPostId: string | null = null;

  const commentAttribution = () => ({
    workspaceId,
    platform: platform ?? "instagram",
    externalCommentId: payload.comment.id,
    authorUsername: payload.comment.author?.username ?? null,
    isOwn: own,
    commentedAt: payload.comment.createdAt ?? null,
    socialPostId: commentedPostId,
    // Un comentario sobre un anuncio trae `comment.ad.id` (SDK 0.2.519, solo Instagram).
    adId: typeof payload.comment.ad?.id === "string" ? payload.comment.ad.id : null,
    // La cuenta nuestra donde comentaron (varias cuentas de la misma red): su id en Zernio y su nombre.
    account: {
      id: payload.account.id,
      label: accountLabel({
        platform: platform ?? socialAccount?.platform ?? "instagram",
        username: channel?.username ?? socialAccount?.username ?? null,
        display_name: channel?.display_name ?? null,
      }),
    },
  });

  // Ack before processing (same 5s delivery budget as messages); processComment
  // additionally dedupes on (channel_id, platform_comment_id) so cross-event
  // redeliveries of the same comment stay one-shot.
  after(async () => {
    // Guardar va primero y nunca puede tumbar la automatizacion: perder un
    // comentario de la tabla es malo; no contestarle al lead es peor.
    try {
      const result = await storeComment(supabase, {
        workspaceId,
        socialAccountId: socialAccount?.id ?? null,
        comment: {
          platform: platform ?? socialAccount?.platform ?? "instagram",
          externalCommentId: payload.comment.id,
          parentExternalCommentId: payload.comment.parentCommentId,
          externalPostId: payload.comment.platformPostId,
          authorExternalId: payload.comment.author?.id ?? null,
          authorUsername: payload.comment.author?.username ?? null,
          authorName: payload.comment.author?.name ?? null,
          authorAvatarUrl: payload.comment.author?.picture ?? null,
          isOwn: own,
          text: payload.comment.text,
          commentedAt: payload.comment.createdAt,
          source: "webhook",
        },
      });
      commentedPostId = result.socialPostId;
      if (result.stored && !own) {
        // Vincula al contacto (en TikTok crea uno anonimo, en Instagram solo si
        // ya existe) y anota el toque. Nunca lanza (F86).
        await attributeComment(supabase, commentAttribution());
      }
    } catch (err) {
      console.error("[webhook] no pude guardar el comentario:", err);
    }

    // Un comentario propio no dispara nada, y sin canal no hay flow que
    // correr (TikTok no tiene bandeja).
    if (own || !channel) return;

    try {
      await processComment({
        supabase,
        channel,
        comment: {
          id: payload.comment.id,
          // Native posts (not published through Zernio) have a null postId; fall
          // back to the platform post id so flows still run. Zernio's private-reply
          // endpoint only needs the comment id, so the placeholder is harmless.
          postId: payload.comment.postId || payload.comment.platformPostId,
          text: payload.comment.text,
          author: payload.comment.author,
        },
      });
    } catch (err) {
      console.error("Webhook comment processing error:", err);
    }

    // El flow por palabra clave puede haber CREADO al contacto recien ahora: se
    // vuelve a intentar. El toque se deduplica por el id del comentario, asi que
    // si ya estaba anotado no se duplica (F86).
    try {
      await attributeComment(supabase, commentAttribution());
    } catch (err) {
      console.error("[webhook] la atribución del comentario falló:", err instanceof Error ? err.message : err);
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}


/**
 * Una red termino de publicar (F35).
 *
 * La cuenta se busca en `social_accounts` y no en `channels`: se publica en
 * redes que no conversan (YouTube, LinkedIn), y esas no tienen canal.
 *
 * Sin canal no hay `channels.webhook_secret`, asi que la firma se valida
 * contra el secreto del workspace de la cuenta.
 */
async function handlePostPlatformWebhook(
  parsed: { event?: string; id?: string },
  rawBody: string,
  signature: string | null,
  eventId: string | null | undefined,
) {
  const event = fromZernioPlatformEvent(parsed);
  if (!event) {
    return NextResponse.json({ ok: true, skipped: parsed.event ?? "sin evento" });
  }

  const supabase = await createServiceClient();

  const { data: publication } = await supabase
    .from("social_posts")
    .select("workspace_id")
    .eq("publisher_ref", event.ref)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (!publication) {
    // Un post de Zernio que no salio de acá: se reconoce y se ignora.
    return NextResponse.json({ ok: true, skipped: "publicacion desconocida" });
  }

  const secret = await resolveWebhookSecret(supabase, {
    workspace_id: publication.workspace_id,
    webhook_secret: null,
  });
  if (!secret) {
    console.error(
      `[webhook] el workspace ${publication.workspace_id} no tiene secreto; no puedo validar la firma`,
    );
    return NextResponse.json({ error: "Webhook sin secreto configurado" }, { status: 401 });
  }
  if (!verifyWebhookSignature(secret, rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!(await claimWebhookEvent(supabase, eventId))) {
    return NextResponse.json({ ok: true, skipped: "evento repetido" });
  }

  const settled = await settlePublication(supabase, event);
  return NextResponse.json({ ok: true, settled });
}

/**
 * `account.connected` / `account.disconnected`: una cuenta que se conecto o
 * desconecto en Zernio.
 *
 * La cuenta nueva no tiene canal, asi que el negocio se identifica por la firma
 * (`findWorkspaceForSignedEvent`): sin firma valida, 401. Se responde enseguida y
 * el trabajo (leer la lista de Zernio, armar canales y cuentas) va en el
 * `after()`, que nunca lanza.
 */
async function handleAccountWebhook(
  parsed: { event?: string; id?: string },
  rawBody: string,
  signature: string | null,
  eventId: string | null | undefined,
) {
  const event = parseAccountEvent(parsed);
  if (!event) {
    return NextResponse.json({ ok: true, skipped: parsed.event ?? "sin evento" });
  }

  const supabase = await createServiceClient();

  const workspaceId = await findWorkspaceForSignedEvent(supabase, rawBody, signature, event.accountId);
  if (!workspaceId) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!(await claimWebhookEvent(supabase, eventId))) {
    return NextResponse.json({ ok: true, skipped: "evento repetido" });
  }

  after(() => refreshZernioAccounts(supabase, workspaceId, `webhook ${event.event}`));
  return NextResponse.json({ ok: true, accepted: event.event });
}
