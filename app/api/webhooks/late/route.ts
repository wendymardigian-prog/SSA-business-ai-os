/**
 * Receptor de los webhooks de Zernio (Instagram: DMs, story replies y comentarios).
 *
 * Es el unico receptor del sistema junto con /api/webhooks/evolution. Vive en la
 * app y no en una Edge Function porque el motor de flows, las secuencias y (en
 * Fase 3) el agente de IA corren en Node: desde Deno no se pueden llamar.
 *
 * Los mensajes de Instagram NO se guardan en la tabla local: Zernio es la fuente
 * de verdad y la app le pide el hilo por API (ver app/api/v1/messages). Lo que se
 * guarda aca es el contacto y la conversacion, que es lo que hace aparecer el
 * chat en la bandeja.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveWebhookSecret, verifyWebhookSignature } from "@/lib/zernio-webhook";
import { upsertContactForSender } from "@/lib/inbox-sync";
import { processComment } from "@/lib/comment-processor";
import type { Database } from "@/lib/types/database";
import { messagePreview } from "@/lib/message-preview";
import {
  applyOptOut,
  pauseSequencesOnReply,
  claimWebhookEvent,
  runInboundAutomation,
  upsertConversation,
} from "@/lib/inbound";

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

  if (parsed.event === "comment.received") {
    return handleCommentWebhook(parsed as CommentWebhookPayload, body, signature, eventId);
  }

  // Everything else besides message.received is acknowledged and ignored
  if (parsed.event !== "message.received") {
    return NextResponse.json({ ok: true, skipped: parsed.event ?? "sin evento" });
  }

  const payload = parsed as WebhookPayload;

  const { message: msg, account } = payload;

  // Ignore outbound messages (sent by the bot itself) to prevent loops
  if (msg.direction === "outbound") {
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
      `[webhook] el workspace ${channel.workspace_id} no tiene webhook_secret; no puedo validar la firma`
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

  const preview = messagePreview(msg.text);

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

  // Messages are stored by Zernio (source of truth) — no local insert needed.

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

  await runInboundAutomation({
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
}

// ── Comment webhook ─────────────────────────────────────────────────────────

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

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  // Prevent loops: our own comments (e.g. the configured public reply) also
  // arrive as comment.received and must never re-trigger a flow.
  if (
    payload.comment.author?.username &&
    payload.comment.author.username === channel.username
  ) {
    return NextResponse.json({ ok: true, skipped: "comentario propio" });
  }

  const secret = await resolveWebhookSecret(supabase, channel);
  if (!secret) {
    console.error(
      `[webhook] el workspace ${channel.workspace_id} no tiene webhook_secret; no puedo validar la firma`
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
