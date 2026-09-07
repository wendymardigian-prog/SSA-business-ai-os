import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import { messagePreview } from "@/lib/message-preview";
import {
  EvolutionError,
  getEvolutionConfig,
  sendText,
} from "@/lib/evolution-client";

/**
 * GET /api/v1/messages?conversationId=...
 *
 * De donde sale el hilo depende del canal:
 * - Zernio (Instagram, ...): Zernio es la fuente de verdad, se le pide por API
 *   y la tabla local messages queda vacia para esos canales.
 * - Evolution (WhatsApp): no hay una API equivalente donde vivan los mensajes,
 *   asi que la fuente de verdad es nuestra tabla messages, que llena el webhook.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("late_conversation_id, workspace_id, channels(late_account_id, provider)")
    .eq("id", conversationId)
    .single();

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const channelRef = conversation.channels as
    | { late_account_id: string; provider: string }
    | null;

  if (channelRef?.provider === "evolution") {
    // RLS ya filtro la conversacion: si el usuario llego hasta aca, puede verla.
    const { data: messages, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to read WhatsApp messages:", error);
      return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
    }
    return NextResponse.json(messages ?? []);
  }

  if (!conversation.late_conversation_id) {
    return NextResponse.json({ error: "Conversation not found or missing Zernio ID" }, { status: 404 });
  }

  const apiKey = await getZernioApiKey(conversation.workspace_id);

  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 400 });
  }

  if (!channelRef?.late_account_id) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }
  const channel = channelRef;

  // Fetch messages from Zernio API
  try {
    const zernio = createZernioClient(apiKey);
    const res = await zernio.messages.getInboxConversationMessages({
      path: { conversationId: conversation.late_conversation_id },
      query: { accountId: channel.late_account_id },
    });

    // The Zernio endpoint returns { success, messages: [...] } — NOT { data }.
    const zernioMessages =
      (res.data as { messages?: unknown[] })?.messages ??
      (res.data as { data?: unknown[] })?.data ??
      [];

    // Map Zernio messages to the shape the inbox UI expects
    const messages = zernioMessages.map((m: any) => ({
      id: m.id,
      conversation_id: conversationId,
      direction: m.direction === "outbound" ? "outbound" : "inbound",
      text: m.text ?? m.message ?? null,
      attachments: m.attachments?.length ? m.attachments : null,
      quick_reply_payload: null,
      postback_payload: null,
      callback_data: null,
      platform_message_id: m.platformMessageId ?? null,
      sent_by_flow_id: null,
      sent_by_node_id: null,
      sent_by_user_id: null,
      status: "sent",
      created_at: m.sentAt ?? m.createdAt ?? new Date().toISOString(),
    }));

    return NextResponse.json(messages);
  } catch (error) {
    console.error("Failed to fetch messages from Zernio API:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/messages
 *
 * Manda por el canal que corresponda. Zernio guarda el mensaje del lado de
 * ellos; para WhatsApp lo guardamos nosotros, con el id que devuelve Evolution
 * para que el eco del webhook no lo duplique.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { conversationId, text } = body;

  if (!conversationId || !text) {
    return NextResponse.json(
      { error: "conversationId and text required" },
      { status: 400 }
    );
  }

  // Get conversation with channel info
  const { data: conversation } = await supabase
    .from("conversations")
    .select("*, channels(*)")
    .eq("id", conversationId)
    .single();

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const outChannel = conversation.channels as {
    id: string;
    late_account_id: string;
    provider: string;
    evolution_instance: string | null;
  } | null;

  if (outChannel?.provider === "evolution") {
    return sendViaEvolution({
      supabase,
      conversationId,
      channel: outChannel,
      contactId: conversation.contact_id,
      text,
      userId: user.id,
    });
  }

  if (!conversation.late_conversation_id) {
    return NextResponse.json(
      { error: "No Zernio conversation ID linked to this conversation" },
      { status: 400 }
    );
  }

  const channel = conversation.channels as { late_account_id: string } | null;
  if (!channel?.late_account_id) {
    return NextResponse.json({ error: "Channel not found or missing Zernio account ID" }, { status: 404 });
  }

  const apiKey = await getZernioApiKey(conversation.workspace_id);

  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 400 });
  }

  // Send via Zernio SDK — Zernio stores the message, no local insert needed
  try {
    const zernio = createZernioClient(apiKey);
    const res = await zernio.messages.sendInboxMessage({
      path: { conversationId: conversation.late_conversation_id },
      body: { accountId: channel.late_account_id, message: text },
    });

    const messageId = (res.data as any)?.data?.messageId ?? null;

    // Update conversation's last message info (ZernFlow-specific metadata)
    await supabase
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: messagePreview(text),
      })
      .eq("id", conversationId);

    // Return a message-shaped response for the UI's optimistic update
    return NextResponse.json(
      {
        id: messageId ?? `sent-${Date.now()}`,
        conversation_id: conversationId,
        direction: "outbound",
        text,
        attachments: null,
        quick_reply_payload: null,
        postback_payload: null,
        callback_data: null,
        platform_message_id: messageId,
        sent_by_flow_id: null,
        sent_by_node_id: null,
        sent_by_user_id: user.id,
        status: "sent",
        created_at: new Date().toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to send message via Zernio API:", error);
    return NextResponse.json(
      { error: `Failed to send message: ${error}` },
      { status: 500 }
    );
  }
}

/**
 * Envio por WhatsApp. El numero sale de contact_channels.platform_sender_id,
 * que es donde el webhook guarda el telefono normalizado del lead.
 */
async function sendViaEvolution({
  supabase,
  conversationId,
  channel,
  contactId,
  text,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  conversationId: string;
  channel: { id: string; evolution_instance: string | null };
  contactId: string;
  text: string;
  userId: string;
}) {
  const config = getEvolutionConfig();
  if (!config || !channel.evolution_instance) {
    return NextResponse.json(
      { error: "WhatsApp no esta configurado en este entorno" },
      { status: 400 }
    );
  }

  const { data: link } = await supabase
    .from("contact_channels")
    .select("platform_sender_id")
    .eq("channel_id", channel.id)
    .eq("contact_id", contactId)
    .maybeSingle();

  if (!link?.platform_sender_id) {
    return NextResponse.json(
      { error: "Este contacto no tiene un numero de WhatsApp vinculado" },
      { status: 400 }
    );
  }

  let messageId: string | null = null;
  try {
    const sent = await sendText(
      config,
      channel.evolution_instance,
      link.platform_sender_id,
      text
    );
    messageId = sent.id;
  } catch (error) {
    const message = error instanceof EvolutionError ? error.message : String(error);
    console.error("Failed to send WhatsApp message:", message);
    return NextResponse.json(
      { error: `No se pudo enviar el mensaje: ${message}` },
      { status: 502 }
    );
  }

  const now = new Date().toISOString();

  // Evolution tambien manda el eco por webhook. Guardar aca con el mismo
  // platform_message_id hace que el indice unico descarte el duplicado, sin
  // importar cual de los dos llegue primero.
  const { data: stored } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      text,
      platform_message_id: messageId,
      sent_by_user_id: userId,
      status: "sent",
      created_at: now,
    })
    .select("*")
    .single();

  await supabase
    .from("conversations")
    .update({ last_message_at: now, last_message_preview: messagePreview(text) })
    .eq("id", conversationId);

  return NextResponse.json(
    stored ?? {
      id: messageId ?? `sent-${Date.now()}`,
      conversation_id: conversationId,
      direction: "outbound",
      text,
      attachments: null,
      platform_message_id: messageId,
      sent_by_user_id: userId,
      status: "sent",
      created_at: now,
    },
    { status: 201 }
  );
}
