import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { logAudit } from "@/lib/audit";

/**
 * Una persona del equipo respondio a mano en una conversacion (F31).
 *
 * Tres efectos, siempre juntos:
 *   - El agente queda FORZADO APAGADO en esa conversacion (false, no "heredar":
 *     si una persona tomo la conversacion, el agente no vuelve solo aunque el
 *     maestro del canal este prendido). Human Takeover implicito. Si la
 *     persona escribio, la conversacion es suya; el agente no puede contestar
 *     encima.
 *   - La marca de error del agente se borra: alguien ya se hizo cargo.
 *   - El contador de respuestas del agente se reinicia solo, porque se calcula
 *     desde el ultimo mensaje con sent_by_user_id (que quien llama ya guardo).
 *
 * Se escribe con el cliente del usuario: la RLS de conversations aplica el
 * scope de leads, igual que al enviar.
 */
export async function applyManualReply(
  supabase: SupabaseClient<Database>,
  args: { conversationId: string; workspaceId: string; userId: string },
): Promise<void> {
  const { data: before } = await supabase
    .from("conversations")
    .select("agent_enabled, last_agent_error_at")
    .eq("id", args.conversationId)
    .maybeSingle();
  // Ya estaba forzado apagado y sin marca de error: nada que hacer.
  if (!before || (before.agent_enabled === false && !before.last_agent_error_at)) return;
  // Se copia antes de escribir: el audit tiene que decir de que estado vino.
  const previous = before.agent_enabled ?? null;

  const { error } = await supabase
    .from("conversations")
    .update({ agent_enabled: false, last_agent_error_at: null, last_agent_error_run_id: null })
    .eq("id", args.conversationId);
  if (error) {
    console.error("[manual-reply] no pude apagar el agente de la conversacion:", error.message);
    return;
  }

  if (previous !== false) {
    await logAudit({
      supabase,
      workspaceId: args.workspaceId,
      entityType: "conversation",
      entityId: args.conversationId,
      action: "agent_toggled",
      changes: { agent_enabled: { old: previous, new: false } },
      metadata: { reason: "manual_reply" },
      performedBy: args.userId,
    });
  }
}
