/**
 * Las reacciones que LLEGAN (A3): las del contacto por WhatsApp (Evolution) y
 * las que avisa Zernio.
 *
 * LA REGLA: una reaccion NO es un mensaje. WhatsApp la manda como un
 * `messages.upsert` comun (con un `reactionMessage` adentro); si siguiera el
 * camino de un mensaje, se guardaria como un entrante VACIO, sumaria un no
 * leido, correria las automatizaciones y le daria turno al agente por algo que
 * el contacto no dijo. Por eso los dos receptores la atajan ANTES del camino de
 * los mensajes, la guardan en `message_reactions` y devuelven.
 *
 * Nada de lo de aca lanza: una reaccion que no se pudo guardar no puede tumbar
 * un webhook.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { recordReaction } from "@/lib/messages/reactions-store";

type Db = SupabaseClient<Database>;

export interface ParsedReaction {
  /** El id del mensaje al que se reacciono, como lo conoce el proveedor. */
  targetId: string;
  /** Vacio = la reaccion se quito. */
  emoji: string;
}

/** La reaccion que trae un mensaje de Baileys (el de `data.message`), o null si no es una reaccion. */
export function parseBaileysReaction(message: unknown): ParsedReaction | null {
  if (!message || typeof message !== "object") return null;
  const reaction = (message as { reactionMessage?: unknown }).reactionMessage;
  if (!reaction || typeof reaction !== "object") return null;
  const r = reaction as { key?: { id?: unknown }; text?: unknown };
  const targetId = typeof r.key?.id === "string" ? r.key.id : "";
  if (!targetId) return null;
  return { targetId, emoji: typeof r.text === "string" ? r.text.trim() : "" };
}

/** La reaccion que avisa Zernio (`reaction.received`), o null si el aviso no trae a que mensaje. */
export function parseZernioReaction(payload: unknown): ParsedReaction | null {
  if (!payload || typeof payload !== "object") return null;
  const reaction = (payload as { reaction?: unknown }).reaction;
  if (!reaction || typeof reaction !== "object") return null;
  const r = reaction as { emoji?: unknown; action?: unknown; platformMessageId?: unknown; messageId?: unknown };
  const targetId = typeof r.platformMessageId === "string" && r.platformMessageId ? r.platformMessageId : typeof r.messageId === "string" ? r.messageId : "";
  if (!targetId) return null;
  const removed = r.action === "removed";
  return { targetId, emoji: removed ? "" : typeof r.emoji === "string" ? r.emoji.trim() : "" };
}

/**
 * WhatsApp: guarda la reaccion en la conversacion de ESA persona en ESE canal.
 * `senderId` es su identidad en el canal: el telefono o, si WhatsApp no lo
 * comparte, su @lid (lib/whatsapp-sender.ts).
 * `fromMe` es verdadero cuando la puso el telefono del negocio (WhatsApp Web o
 * la app): cuenta como del negocio, no del contacto.
 */
export async function handleWhatsappReaction(
  service: Db,
  channel: { id: string; workspace_id: string },
  args: { senderId: string; reaction: ParsedReaction; fromMe: boolean },
): Promise<"saved" | "ignored"> {
  try {
    const { data: link } = await service
      .from("contact_channels")
      .select("contact_id")
      .eq("channel_id", channel.id)
      .eq("platform_sender_id", args.senderId)
      .maybeSingle();
    if (!link?.contact_id) return "ignored";

    const { data: conversation } = await service
      .from("conversations")
      .select("id")
      .eq("channel_id", channel.id)
      .eq("contact_id", link.contact_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conversation) return "ignored";

    const saved = await recordReaction(service, {
      workspaceId: channel.workspace_id,
      conversationId: conversation.id,
      platformMessageId: args.reaction.targetId,
      emoji: args.reaction.emoji,
      actor: args.fromMe ? "business" : "contact",
    });
    return saved ? "saved" : "ignored";
  } catch (err) {
    console.error("[reaction] no pude procesar la reaccion de WhatsApp:", err instanceof Error ? err.message : "error");
    return "ignored";
  }
}

/** Zernio: la conversacion se encuentra por su id de Zernio en ESTE canal. */
export async function handleZernioReaction(
  service: Db,
  channel: { id: string; workspace_id: string },
  args: { lateConversationId: string; reaction: ParsedReaction },
): Promise<"saved" | "ignored"> {
  try {
    const { data: conversation } = await service
      .from("conversations")
      .select("id")
      .eq("channel_id", channel.id)
      .eq("late_conversation_id", args.lateConversationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!conversation) return "ignored";

    const saved = await recordReaction(service, {
      workspaceId: channel.workspace_id,
      conversationId: conversation.id,
      platformMessageId: args.reaction.targetId,
      emoji: args.reaction.emoji,
      actor: "contact",
    });
    return saved ? "saved" : "ignored";
  } catch (err) {
    console.error("[reaction] no pude procesar la reaccion de Zernio:", err instanceof Error ? err.message : "error");
    return "ignored";
  }
}
