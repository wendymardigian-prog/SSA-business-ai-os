import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { SendContext } from "@/lib/flow-engine/send";

/**
 * El contexto que necesita sendChannelMessage cuando el que manda es el cron.
 *
 * Antes el procesador armaba su propio cliente de Zernio y mandaba a mano. Eso
 * dejaba tres agujeros: el tope de 200 mensajes automatizados por hora de
 * Instagram no se contaba, una secuencia sobre un canal de WhatsApp cortaba en
 * silencio, y los errores de la API llegaban crudos. Los tres ya estaban
 * resueltos en lib/flow-engine/send.ts para el motor; esto es lo unico que
 * faltaba para que las secuencias salgan por la misma puerta.
 */

export type SequenceSendContext = SendContext;

export type BuildContextResult =
  | { ok: true; context: SequenceSendContext }
  | { ok: false; reason: "no_conversation" };

/**
 * Busca la conversacion del contacto en ese canal.
 *
 * Si no hay, no hay por donde escribirle: Instagram solo permite hablarle a
 * quien escribio primero. Quien llama pausa la inscripcion en vez de
 * reintentar contra una puerta que no existe.
 */
export async function buildSequenceSendContext(
  supabase: SupabaseClient<Database>,
  enrollment: { contact_id: string; channel_id: string },
  workspaceId: string
): Promise<BuildContextResult> {
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, late_conversation_id")
    .eq("contact_id", enrollment.contact_id)
    .eq("channel_id", enrollment.channel_id)
    .maybeSingle();

  if (!conversation) return { ok: false, reason: "no_conversation" };

  return {
    ok: true,
    context: {
      workspaceId,
      channelId: enrollment.channel_id,
      contactId: enrollment.contact_id,
      conversationId: conversation.id,
      lateConversationId: conversation.late_conversation_id ?? undefined,
      // No nace de un flow. La columna sent_by_flow_id tiene FK a flows, asi
      // que null es lo unico correcto: un uuid inventado rompe el insert.
      flowId: null,
    },
  };
}
