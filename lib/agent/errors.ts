import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createNotificationOnce } from "@/lib/notifications/create";

/**
 * Visibilidad de los turnos que el agente no pudo completar.
 *
 * El sistema existe para que ningun lead quede sin respuesta. Un turno que se
 * descarta en silencio (job vencido, error, proveedor caido) deja justo eso: un
 * lead esperando y nadie enterado. Por eso tres cosas, siempre juntas:
 *
 *   1. La marca en la conversacion (last_agent_error_at / _run_id), que
 *      alimenta el filtro de la bandeja y el punto en la lista.
 *   2. Una notificacion en la campana.
 *   3. El run, que ya lo deja quien llama.
 *
 * La marca NO se pone cuando el agente se abstiene por una automatizacion, un
 * guardarrail deriva bien o el canal esta apagado: eso es comportamiento
 * correcto y ya queda en el historial de runs.
 *
 * Se borra con una respuesta buena del agente, un mensaje de una persona del
 * equipo o el cierre de la conversacion. Nunca por paso del tiempo ni porque el
 * lead vuelva a escribir.
 */

type Db = SupabaseClient<Database>;

export type AgentErrorKind = "turn_error" | "job_expired" | "provider_unavailable" | "model_timeout";

const TITLES: Record<AgentErrorKind, string> = {
  turn_error: "El agente no pudo responder",
  job_expired: "Un turno del agente quedo sin responder",
  provider_unavailable: "El proveedor de IA no respondio",
  model_timeout: "El agente tardo demasiado y no respondio",
};

const BODIES: Record<AgentErrorKind, string> = {
  turn_error: "Hubo un error al generar la respuesta. Revisa la conversacion: el lead puede estar esperando.",
  job_expired: "El turno se descarto porque paso demasiado tiempo. Revisa la conversacion: el lead puede estar esperando.",
  provider_unavailable:
    "Fallaron el modelo principal y el de respaldo. La conversacion se derivo a una persona. Conviene revisar la API key del proveedor.",
  model_timeout: "El modelo no respondio a tiempo. Revisa la conversacion: el lead puede estar esperando.",
};

export async function markAgentError(
  supabase: Db,
  args: {
    workspaceId: string;
    conversationId: string;
    runId: string | null;
    kind: AgentErrorKind;
    assignedTo?: string | null;
    now?: Date;
  },
): Promise<void> {
  const now = args.now ?? new Date();
  const { error } = await supabase
    .from("conversations")
    .update({ last_agent_error_at: now.toISOString(), last_agent_error_run_id: args.runId })
    .eq("id", args.conversationId);
  if (error) console.error("[agent-error] no pude marcar la conversacion:", error.message);

  await createNotificationOnce({
    supabase,
    workspaceId: args.workspaceId,
    type: "agent_error",
    title: TITLES[args.kind],
    body: BODIES[args.kind],
    entityType: "conversation",
    entityId: args.conversationId,
    recipientId: args.assignedTo ?? null,
    metadata: { run_id: args.runId, kind: args.kind },
    withinMinutes: 30,
  });
}

/** Borra la marca. No toca nada si no habia. */
export async function clearAgentError(supabase: Db, conversationId: string): Promise<void> {
  const { error } = await supabase
    .from("conversations")
    .update({ last_agent_error_at: null, last_agent_error_run_id: null })
    .eq("id", conversationId)
    .not("last_agent_error_at", "is", null);
  if (error) console.error("[agent-error] no pude borrar la marca:", error.message);
}
