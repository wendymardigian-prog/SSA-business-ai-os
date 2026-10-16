"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMemberAction } from "@/lib/auth/guards";
import { canReplyOn } from "@/lib/inbox/channel-access";
import { sendReactionToProvider } from "@/lib/channels/send-reaction";
import { recordReaction } from "@/lib/messages/reactions-store";
import type { ReactionRow } from "@/lib/messages/reactions";

/**
 * Reaccionar a un mensaje desde la bandeja (A3).
 *
 * Es operar la conversacion, no configurar: pide poder responder por el canal
 * (`inbox.<canal>.reply`) y la RLS acota a las conversaciones que la persona
 * ve. Se lee y se chequea con el cliente del USUARIO; el cliente de servicio
 * solo se usa para las claves del proveedor y para escribir la reaccion (la
 * tabla no tiene policies de escritura).
 *
 * El workspace sale de la conversacion que la persona ve, nunca del pedido. Un
 * mensaje que esta en `messages` manda sus propios datos (direccion, ids del
 * proveedor); solo el hilo de Instagram, que se lee en vivo de Zernio, trae los
 * ids desde el navegador.
 */

type Result = { ok: true; notice?: string } | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;

export async function reactToMessage(input: {
  conversationId: string;
  /** El id de la fila de `messages`, si el mensaje esta guardado. */
  messageId?: string | null;
  platformMessageId?: string | null;
  platformNativeMessageId?: string | null;
  /** Vacio quita la reaccion. */
  emoji: string;
}): Promise<Result> {
  if (typeof input?.conversationId !== "string" || !UUID.test(input.conversationId) || typeof input.emoji !== "string") {
    return { ok: false, error: "No pude reaccionar: faltan datos del mensaje." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  const access = await getMemberAction();
  if (!access) return { ok: false, error: "Tu rol no puede responder por este canal." };

  const { data } = await supabase
    .from("conversations")
    .select("id, workspace_id, channel_id, contact_id, late_conversation_id, deleted_at, channels(platform)")
    .eq("id", input.conversationId)
    .maybeSingle();
  const conversation = data as unknown as {
    id: string;
    workspace_id: string;
    channel_id: string;
    contact_id: string;
    late_conversation_id: string | null;
    deleted_at: string | null;
    channels?: { platform?: string } | null;
  } | null;
  if (!conversation || conversation.deleted_at) return { ok: false, error: "No encontré esa conversación." };
  if (!canReplyOn(access.can, conversation.channels?.platform ?? null)) {
    return { ok: false, error: "Tu rol no puede responder por este canal." };
  }

  // Lo que dice la base manda sobre lo que dice el navegador.
  let direction: "inbound" | "outbound" = "inbound";
  let platformMessageId = input.platformMessageId ?? null;
  let platformNativeMessageId = input.platformNativeMessageId ?? null;
  if (input.messageId && UUID.test(input.messageId)) {
    const { data: stored } = await supabase
      .from("messages")
      .select("conversation_id, direction, platform_message_id, platform_native_message_id")
      .eq("id", input.messageId)
      .maybeSingle();
    if (!stored || stored.conversation_id !== conversation.id) return { ok: false, error: "No encontré ese mensaje." };
    direction = stored.direction === "outbound" ? "outbound" : "inbound";
    platformMessageId = stored.platform_message_id ?? platformMessageId;
    platformNativeMessageId = stored.platform_native_message_id ?? platformNativeMessageId;
  }

  const service = await createServiceClient();
  const result = await sendReactionToProvider({
    supabase,
    secrets: service,
    emoji: input.emoji,
    target: {
      workspaceId: conversation.workspace_id,
      channelId: conversation.channel_id,
      contactId: conversation.contact_id,
      lateConversationId: conversation.late_conversation_id,
      direction,
      platformMessageId,
      platformNativeMessageId,
    },
  });
  if (!result.ok) return { ok: false, error: result.message };

  // La reaccion ya salio: si no se pudo guardar, la burbuja no la muestra hasta que el proveedor la devuelva, pero no es un error para la persona.
  const reactedId = platformMessageId ?? platformNativeMessageId;
  if (reactedId) {
    await recordReaction(service, {
      workspaceId: conversation.workspace_id,
      conversationId: conversation.id,
      platformMessageId: reactedId,
      emoji: input.emoji.trim(),
      actor: "business",
      userId: user.id,
    });
  }
  return { ok: true };
}

/** Las reacciones vigentes de una conversacion (la RLS acota a las que se ven). */
export async function loadConversationReactions(conversationId: string): Promise<ReactionRow[]> {
  if (typeof conversationId !== "string" || !UUID.test(conversationId)) return [];
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("message_reactions")
    .select("message_id, platform_message_id, emoji, actor_key, removed_at, created_at")
    .eq("conversation_id", conversationId)
    .is("removed_at", null)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) {
    console.error("[reactions] no pude leer las reacciones:", error.message);
    return [];
  }
  return (data ?? []) as ReactionRow[];
}
