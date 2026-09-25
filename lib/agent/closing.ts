import type { SupabaseClient } from "@supabase/supabase-js";
import { LIVE_DRAFT_STATUSES } from "./drafts/types";
import type { Database } from "@/lib/types/database";
import { CONVERSATION_CLOSE_JOB, scheduleJob, type ConversationClosePayload } from "@/lib/scheduler";
import { getAgentType } from "./agent-types";
import { loadWorkspaceAgents, resolveAgentState } from "./config";
import { summarizeConversationOnClose, type SummaryDeps, type SummaryOutcome } from "./summary";

/**
 * El cierre de conversaciones (F33/F34): quien cierra y que pasa despues.
 *
 * Dos caminos cierran una conversacion, y los dos encolan el mismo job:
 *   - Una persona, desde la bandeja (closeConversation en lib/actions).
 *   - El barrido de inactividad, que corre dentro del cron de jobs (cada
 *     minuto, lote chico, consulta indexada).
 *
 * El barrido cierra SOLO conversaciones abiertas donde el agente esta
 * efectivamente activo (resolveAgentState) Y ya participo (tiene al menos un
 * run de source agent). Lo segundo es a proposito: hay 578 conversaciones
 * inactivas de antes del agente; cerrarlas y resumirlas el dia que se prenda
 * el maestro serian 578 llamadas al modelo de golpe. Esas se cierran a mano.
 * Las conversaciones que maneja una persona tampoco se cierran solas.
 *
 * El job lo procesa el runner general (reintentos con backoff) y llama a
 * summarizeConversationOnClose, que resume y clasifica.
 */

type Db = SupabaseClient<Database>;

const SWEEP_BATCH = 50;

export async function enqueueConversationClose(service: Db, payload: ConversationClosePayload): Promise<boolean> {
  try {
    await scheduleJob(service, CONVERSATION_CLOSE_JOB, { ...payload }, new Date());
    return true;
  } catch (err) {
    console.error("[closing] no pude encolar el cierre:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

export interface SweepResult {
  closed: number;
  candidates: number;
}

export async function sweepInactiveConversations(service: Db, now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = { closed: 0, candidates: 0 };

  // Los agentes de todos los workspaces: el barrido corre sin usuario.
  const { data: agentRows, error } = await service.from("agents").select("workspace_id").is("deleted_at", null);
  if (error) {
    console.error("[closing] no pude leer los agentes:", error.message);
    return result;
  }
  const workspaceIds = [...new Set((agentRows ?? []).map((a) => a.workspace_id))];

  for (const workspaceId of workspaceIds) {
    const agents = await loadWorkspaceAgents(service, workspaceId);
    for (const agent of agents) {
      if (!agent.isEnabled || !getAgentType(agent.type)?.conversational || agent.enabledChannelIds.length === 0) continue;
      const cutoff = new Date(now.getTime() - agent.closeAfterInactiveHours * 3_600_000).toISOString();

      const { data: rows } = await service
        .from("conversations")
        .select("id, channel_id, agent_enabled, agent_paused_until, last_message_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "open")
        .is("deleted_at", null)
        .in("channel_id", agent.enabledChannelIds)
        .lt("last_message_at", cutoff)
        .order("last_message_at", { ascending: true })
        .limit(SWEEP_BATCH);

      for (const conv of rows ?? []) {
        result.candidates++;
        const state = resolveAgentState({ agents, channelId: conv.channel_id, conversation: conv, now });
        if (state.state !== "active") continue;

        // Solo si el agente ya participo: el backlog viejo no se toca.
        const { count } = await service
          .from("agent_runs")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", conv.id)
          .eq("source", "agent");
        if (!count) continue;

        // Un lead esperando que alguien apruebe su respuesta no es una
        // conversacion inactiva (Bloque 2c): el borrador no mueve
        // last_message_at, asi que sin esto se cerraria con la pregunta sin
        // responder.
        const { count: liveDrafts } = await service
          .from("agent_drafts")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", conv.id)
          .in("status", LIVE_DRAFT_STATUSES);
        if (liveDrafts) continue;

        // CAS sobre el estado: si un entrante la reabrio en el medio, no se cierra.
        const { data: updated } = await service
          .from("conversations")
          .update({ status: "closed", closed_at: now.toISOString(), last_agent_error_at: null, last_agent_error_run_id: null })
          .eq("id", conv.id)
          .eq("status", "open")
          .select("id");
        if (!updated || updated.length === 0) continue;

        result.closed++;
        await enqueueConversationClose(service, { workspaceId, conversationId: conv.id, trigger: "cron_close" });
      }
    }
  }

  return result;
}

/** Lo que corre el job. Lanza solo si no hay payload valido (no hay reintento que lo arregle... pero el runner lo marca). */
export async function processConversationClose(
  service: Db,
  payload: Partial<ConversationClosePayload> | null,
  deps?: SummaryDeps,
): Promise<SummaryOutcome> {
  if (!payload?.conversationId || !payload.workspaceId) {
    console.error("[closing] job de cierre sin conversationId o workspaceId");
    return { kind: "skipped", reason: "no_conversation" };
  }
  return summarizeConversationOnClose(
    service,
    { conversationId: payload.conversationId, workspaceId: payload.workspaceId, trigger: payload.trigger === "manual" ? "manual" : "cron_close" },
    deps,
  );
}
