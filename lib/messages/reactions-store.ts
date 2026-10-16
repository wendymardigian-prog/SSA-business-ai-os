/**
 * Guarda las reacciones (A3): las que ponemos nosotros y las que llegan del
 * contacto. Solo corre en el servidor, con el cliente de servicio: la tabla no
 * tiene policies de escritura.
 *
 * Una reaccion por actor y mensaje (indice unico): poner otra reemplaza la
 * anterior y quitarla pone `removed_at` (no se borra la fila). Nunca lanza: una
 * reaccion que no se pudo guardar no puede tumbar un webhook ni un envio.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

export interface RecordReactionInput {
  workspaceId: string;
  conversationId: string;
  /** El id con el que el proveedor conoce el mensaje reaccionado. */
  platformMessageId: string;
  /** Vacio = la reaccion se quito. */
  emoji: string;
  actor: "business" | "contact";
  /** Quien la puso desde el sistema (solo `business`). */
  userId?: string | null;
  now?: Date;
}

/** La fila de `messages` que corresponde a un id del proveedor (el de Zernio o el nativo), o null. */
export async function findMessageId(service: Db, conversationId: string, providerMessageId: string): Promise<string | null> {
  for (const column of ["platform_message_id", "platform_native_message_id"] as const) {
    const { data, error } = await service.from("messages").select("id").eq("conversation_id", conversationId).eq(column, providerMessageId).limit(1);
    if (error) {
      console.error("[reaction] no pude buscar el mensaje:", error.message);
      return null;
    }
    if (data && data.length > 0) return data[0].id;
  }
  return null;
}

export async function recordReaction(service: Db, input: RecordReactionInput): Promise<boolean> {
  const now = (input.now ?? new Date()).toISOString();
  try {
    if (input.emoji === "") {
      const { error } = await service
        .from("message_reactions")
        .update({ removed_at: now, updated_at: now } as never)
        .eq("conversation_id", input.conversationId)
        .eq("platform_message_id", input.platformMessageId)
        .eq("actor_key", input.actor)
        .is("removed_at", null);
      if (error) {
        console.error("[reaction] no pude quitar la reaccion:", error.message);
        return false;
      }
      return true;
    }

    const messageId = await findMessageId(service, input.conversationId, input.platformMessageId);
    const { error } = await service.from("message_reactions").upsert(
      {
        workspace_id: input.workspaceId,
        conversation_id: input.conversationId,
        message_id: messageId,
        platform_message_id: input.platformMessageId,
        emoji: input.emoji,
        direction: input.actor === "business" ? "out" : "in",
        actor_key: input.actor,
        reacted_by_user_id: input.actor === "business" ? (input.userId ?? null) : null,
        updated_at: now,
        removed_at: null,
      } as never,
      { onConflict: "conversation_id,platform_message_id,actor_key" },
    );
    if (error) {
      console.error("[reaction] no pude guardar la reaccion:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[reaction] error guardando la reaccion:", err instanceof Error ? err.message : "error");
    return false;
  }
}
