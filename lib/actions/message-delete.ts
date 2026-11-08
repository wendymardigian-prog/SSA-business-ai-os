"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMemberAction } from "@/lib/auth/guards";
import { canReplyChannel } from "@/lib/inbox/channel-access";
import { canDeleteForEveryone } from "@/lib/messages/revoke";
import { markMessageDeletedForEveryone } from "@/lib/messages/revoke-inbound";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { deleteMessageForEveryone as evolutionDeleteForEveryone, EvolutionError } from "@/lib/evolution-client";

/**
 * «Eliminar para todos» desde la bandeja (00353): borra en WhatsApp un mensaje
 * que mandamos nosotros y lo marca borrado (la fila y el texto quedan).
 *
 * Es operar la conversacion: pide poder responder por esa cuenta, y la RLS
 * acota a las conversaciones y mensajes que la persona ve. Se lee con el
 * cliente del USUARIO; el de servicio es para la clave de Evolution y para
 * marcar (la unica puerta, solo service_role). El workspace y el canal salen
 * de la conversacion que la persona ve, nunca del pedido. Lo que decide si se
 * puede es `canDeleteForEveryone`, la misma regla que dibuja el boton.
 */

type Result = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;

export async function deleteMessageForEveryone(messageId: string): Promise<Result> {
  if (typeof messageId !== "string" || !UUID.test(messageId)) {
    return { ok: false, error: "No encontré ese mensaje." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  const access = await getMemberAction();
  if (!access) return { ok: false, error: "Tu rol no puede responder por este canal." };

  const { data: message } = await supabase
    .from("messages")
    .select("id, conversation_id, direction, status, platform_message_id, created_at, deleted_for_everyone_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return { ok: false, error: "No encontré ese mensaje." };

  const { data } = await supabase
    .from("conversations")
    .select("id, workspace_id, channel_id, contact_id, deleted_at, channels(provider, evolution_instance)")
    .eq("id", message.conversation_id)
    .maybeSingle();
  const conversation = data as unknown as {
    id: string;
    workspace_id: string;
    channel_id: string;
    contact_id: string;
    deleted_at: string | null;
    channels?: { provider?: string | null; evolution_instance?: string | null } | null;
  } | null;
  if (!conversation || conversation.deleted_at) return { ok: false, error: "No encontré esa conversación." };
  if (!canReplyChannel(access.permissions, conversation.channel_id)) {
    return { ok: false, error: "Tu rol no puede responder por esta cuenta." };
  }

  const check = canDeleteForEveryone({
    provider: conversation.channels?.provider,
    direction: message.direction,
    status: message.status,
    platformMessageId: message.platform_message_id,
    createdAt: message.created_at,
    deletedAt: message.deleted_for_everyone_at,
  });
  if (!check.ok) return { ok: false, error: check.reason };

  const service = await createServiceClient();
  const instance = conversation.channels?.evolution_instance ?? null;
  const config = await getEvolutionConfig(service, conversation.workspace_id);
  if (!config || !instance) return { ok: false, error: "WhatsApp no está configurado en este entorno." };

  const { data: link } = await supabase
    .from("contact_channels")
    .select("platform_sender_id")
    .eq("channel_id", conversation.channel_id)
    .eq("contact_id", conversation.contact_id)
    .maybeSingle();
  if (!link?.platform_sender_id) return { ok: false, error: "Este contacto no tiene un número de WhatsApp vinculado." };

  try {
    await evolutionDeleteForEveryone(config, instance, {
      to: link.platform_sender_id,
      messageId: message.platform_message_id as string,
    });
  } catch (err) {
    // No se loguea el error crudo: puede traer el telefono. Alcanza con el codigo.
    console.error(`[message-delete] WhatsApp rechazó el borrado (${err instanceof EvolutionError ? (err.status ?? "sin codigo") : "error"})`);
    if (err instanceof EvolutionError && (err.status === 404 || err.status === 400)) {
      return { ok: false, error: "WhatsApp no encontró ese mensaje: puede ser muy viejo o ya estar borrado." };
    }
    return { ok: false, error: "WhatsApp no pudo eliminar el mensaje. Probá de nuevo en un momento." };
  }

  // Ya se borro en WhatsApp: si la marca fallara, el eco de Evolution la vuelve a intentar.
  await markMessageDeletedForEveryone(service, {
    workspaceId: conversation.workspace_id,
    channelId: conversation.channel_id,
    platformMessageId: message.platform_message_id as string,
    source: "app",
    userId: user.id,
  });
  return { ok: true };
}
