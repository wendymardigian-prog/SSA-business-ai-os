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
 * El guardado se puede apagar sin deploy con workspaces.persist_zernio_inbound,
 * mientras se confirman los terminos de Zernio y Meta (ver persistInboundMessage
 * en lib/inbound.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveWebhookSecret, verifyWebhookSignature } from "@/lib/zernio-webhook";
import { upsertContactForSender } from "@/lib/inbox-sync";
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
import { fromZernioPlatformEvent, settlePublication } from "@/lib/publishing/inbound";
import { isOwnComment, linkCommentToContact, storeComment } from "@/lib/comments/store";
import type { SocialPlatform } from "@/lib/types/database";
import { supersedePendingDrafts } from "@/lib/agent/drafts/lifecycle";

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
    attachments: Array<{ type: string; url: string; payload?: string }>;
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
  };
  timestamp: string;
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
  });

  // ── La media, adentro (F3) ────────────────────────────────────────────────
  // Va aca, dentro del after() que ya existe, y no en la cola: la URL del CDN
  // de Meta VENCE. Si se esperara al cron del minuto, a veces se llega tarde y
  // despues no hay nada que escuchar ni que transcribir.
  //
  // Nunca puede voltear el webhook: storeInboundMedia atrapa todo y deja el
  // motivo en el adjunto.
  if (inserted.id && hasDownloadableMedia(attachments)) {
    await storeInboundMedia({
      supabase,
      workspaceId: channel.workspace_id,
      conversationId: conversation.id,
      messageId: inserted.id,
      items: attachments,
    });
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
    attachments?: Array<{ type: string; url: string; payload?: string }>;
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
      if (echo.stored && echo.messageId && echo.conversationId && hasDownloadableMedia(echo.items ?? [])) {
        await storeInboundMedia({
          supabase,
          workspaceId: channel.workspace_id,
          conversationId: echo.conversationId,
          messageId: echo.messageId,
          items: echo.items,
        });
      }
    } catch (err) {
      console.error("Webhook message.sent processing error:", err);
    }
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
  // mensajes, asi que no tiene canal, y hasta F46 sus comentarios rebotaban
  // con un 404. Ahora se busca ademas en social_accounts, que es donde
  // viven las cuentas de publicacion y metricas.
  const { data: socialAccount } = channel && platform
    ? await supabase
        .from("social_accounts")
        .select("id, workspace_id, platform, username, external_id")
        .eq("workspace_id", channel.workspace_id)
        .eq("platform", platform)
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
      if (result.stored && !own) {
        await linkCommentToContact(supabase, {
          workspaceId,
          externalCommentId: payload.comment.id,
          platform: platform ?? "instagram",
          authorUsername: payload.comment.author?.username ?? null,
        });
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
