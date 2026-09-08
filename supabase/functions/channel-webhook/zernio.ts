/**
 * Webhook de Zernio (Instagram: DMs, story replies y comentarios).
 *
 * Que guarda y que no: los mensajes de Instagram los guarda Zernio, que es la
 * fuente de verdad — la app le pide el hilo por API (ver app/api/v1/messages).
 * Asi que aca solo se crea o actualiza el contacto y la conversacion, que es lo
 * que hace aparecer el chat en la bandeja. Los comentarios si se registran en
 * comment_logs, que es donde ZernFlow los guarda.
 *
 * La firma HMAC se valida igual que en /api/webhooks/late: el secreto vive en
 * workspaces.webhook_secret y es el mismo que se registro en Zernio.
 */

import type { SupabaseClient } from "../_shared/db.ts";
import {
  checkOptOut,
  claimEvent,
  messagePreview,
  upsertContact,
  upsertConversation,
  type ChannelRow,
} from "../_shared/inbound.ts";
import { verifyHmacSignature } from "../_shared/hmac.ts";

const CHANNEL_FIELDS =
  "id, workspace_id, platform, provider, evolution_instance, username";

interface MessagePayload {
  id?: string;
  event: string;
  message: {
    id: string;
    direction: string;
    text: string | null;
    sender: { id: string; name: string; username: string | null; picture: string | null };
    sentAt?: string;
  };
  conversation: { id: string };
  account: { id: string };
}

interface CommentPayload {
  id?: string;
  event: string;
  comment: {
    id: string;
    postId: string | null;
    platformPostId: string;
    text: string;
    author: { id?: string; username?: string; name?: string };
  };
  account: { id: string };
}

export async function handleZernio(
  supabase: SupabaseClient,
  body: string,
  headers: Headers,
): Promise<Response> {
  let parsed: { event?: string; id?: string; account?: { id?: string } };
  try {
    parsed = JSON.parse(body);
  } catch {
    return json({ error: "JSON invalido" }, 400);
  }

  const accountId = parsed.account?.id;
  if (!accountId) return json({ ok: true, skipped: "sin cuenta" });

  const { data: channel } = await supabase
    .from("channels")
    .select(CHANNEL_FIELDS)
    .eq("late_account_id", accountId)
    .eq("is_active", true)
    .maybeSingle();

  if (!channel) return json({ ok: true, skipped: "canal desconocido" });

  // Firma. Si el workspace todavia no tiene secreto, no se puede validar nada:
  // se rechaza en vez de aceptar a ciegas, porque esta URL es publica.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("webhook_secret")
    .eq("id", (channel as ChannelRow).workspace_id)
    .single();

  const secret = workspace?.webhook_secret;
  if (!secret) {
    console.error("[zernio] el workspace no tiene webhook_secret; no puedo validar la firma");
    return json({ error: "webhook no configurado" }, 401);
  }
  const signature = headers.get("x-late-signature");
  if (!(await verifyHmacSignature(secret, body, signature))) {
    return json({ error: "firma invalida" }, 401);
  }

  const eventId = parsed.id ?? headers.get("x-late-event-id");

  if (parsed.event === "comment.received") {
    return handleComment(supabase, channel as ChannelRow, JSON.parse(body), eventId);
  }
  if (parsed.event === "message.received") {
    return handleMessage(supabase, channel as ChannelRow, JSON.parse(body), eventId);
  }

  return json({ ok: true, skipped: parsed.event ?? "sin evento" });
}

async function handleMessage(
  supabase: SupabaseClient,
  channel: ChannelRow,
  payload: MessagePayload,
  eventId: string | null,
): Promise<Response> {
  const msg = payload.message;

  // Lo que mandamos nosotros vuelve como evento: ignorarlo evita el bucle.
  if (msg.direction === "outbound") {
    return json({ ok: true, skipped: "mensaje saliente" });
  }

  // Si el remitente es otra cuenta conectada del mismo workspace, tampoco:
  // pasa cuando se prueba mandandose mensajes entre cuentas propias.
  if (msg.sender.username) {
    const { data: own } = await supabase
      .from("channels")
      .select("id")
      .eq("workspace_id", channel.workspace_id)
      .eq("username", msg.sender.username)
      .eq("is_active", true)
      .maybeSingle();
    if (own) return json({ ok: true, skipped: "el remitente es una cuenta propia" });
  }

  if (!(await claimEvent(supabase, eventId))) {
    return json({ ok: true, skipped: "evento repetido" });
  }

  const at = msg.sentAt ?? new Date().toISOString();

  const contact = await upsertContact({
    supabase,
    channel,
    senderId: msg.sender.id,
    senderName: msg.sender.name || msg.sender.username || msg.sender.id,
    senderUsername: msg.sender.username,
    senderPicture: msg.sender.picture,
    interactionAt: at,
  });
  if (!contact) return json({ error: "no pude crear el contacto" }, 500);

  const conversation = await upsertConversation({
    supabase,
    channel,
    contactId: contact.contactId,
    externalConversationId: payload.conversation.id,
    preview: messagePreview(msg.text),
    at,
    incrementUnread: true,
  });
  if (!conversation) return json({ error: "no pude crear la conversacion" }, 500);

  // Los mensajes salientes ya se descartaron arriba, asi que todo lo que llega
  // hasta aca lo escribio el lead.
  await checkOptOut({
    supabase,
    contactId: contact.contactId,
    conversationId: conversation.id,
    text: msg.text ?? null,
  });

  return json({ ok: true, conversationId: conversation.id });
}

async function handleComment(
  supabase: SupabaseClient,
  channel: ChannelRow,
  payload: CommentPayload,
  eventId: string | null,
): Promise<Response> {
  const comment = payload.comment;

  // Nuestras propias respuestas publicas tambien llegan como comment.received.
  if (comment.author?.username && comment.author.username === channel.username) {
    return json({ ok: true, skipped: "comentario propio" });
  }

  if (!(await claimEvent(supabase, eventId))) {
    return json({ ok: true, skipped: "evento repetido" });
  }

  // comment_logs tiene un unico (channel_id, platform_comment_id): si el mismo
  // comentario llega por dos eventos distintos, igual queda una sola fila.
  const { error } = await supabase.from("comment_logs").insert({
    channel_id: channel.id,
    workspace_id: channel.workspace_id,
    post_id: comment.postId ?? comment.platformPostId,
    platform_comment_id: comment.id,
    author_id: comment.author?.id ?? null,
    author_name: comment.author?.name ?? null,
    author_username: comment.author?.username ?? null,
    comment_text: comment.text,
  });

  if (error && error.code !== "23505") {
    console.error("[zernio] no pude registrar el comentario:", error.message);
    return json({ error: "no pude registrar el comentario" }, 500);
  }

  return json({ ok: true, commentId: comment.id });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
