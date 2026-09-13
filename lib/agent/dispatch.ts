import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { InboundAutomationOutcome } from "@/lib/inbound";
import { recordRunOutcome } from "@/lib/ai/run";
import {
  AGENT_BURST_JOB,
  agentBurstKey,
  agentBurstTiming,
  pushDebouncedJob,
  type AgentBurstPayload,
} from "@/lib/scheduler";
import { loadWorkspaceAgents, resolveAgentState, type AgentAvailability } from "./config";

/**
 * El despacho del agente ante un mensaje entrante (F30, F31, F32).
 *
 * ES EL UNICO LUGAR DEL SISTEMA QUE PUEDE AGENDAR UN TURNO DEL AGENTE. Lo
 * llaman los dos receptores de webhooks, despues de guardar el mensaje, del
 * opt-out y de las automatizaciones. El orden de decision es:
 *
 *   automatizaciones (ya evaluadas) -> palancas del agente -> agendar
 *
 * y los guardarrailes se evaluan en el turno, sobre la rafaga completa.
 *
 * Que runs deja el despacho:
 *   - Si la conversacion tiene el agente encendido y no puede actuar (canal
 *     apagado, agente apagado, pausado por un flow, o una automatizacion
 *     reclamo el mensaje), un run con el motivo. Toda abstencion deja rastro.
 *   - Si la conversacion NUNCA tuvo el agente encendido, ninguno: el toggle
 *     arranca apagado en todas las conversaciones, y anotar "no respondi porque
 *     no me lo pidieron" en cada mensaje de cada conversacion llenaria la tabla
 *     de ruido sin decir nada.
 *
 * Nunca lanza: un fallo aca no puede tumbar la recepcion del mensaje.
 */

type Db = SupabaseClient<Database>;

export type AgentDispatchOutcome =
  | { scheduled: true; jobId: string; runAt: string; created: boolean }
  | {
      scheduled: false;
      reason: AgentAvailability["state"] | "automation_claimed" | "not_enabled_here" | "message_persistence_off" | "error";
      runId?: string | null;
    };

export async function maybeScheduleAgentTurn(
  supabase: Db,
  args: {
    workspaceId: string;
    channelId: string;
    contactId: string;
    conversationId: string;
    automation: InboundAutomationOutcome;
    now?: Date;
  },
): Promise<AgentDispatchOutcome> {
  const now = args.now ?? new Date();
  try {
    const agents = await loadWorkspaceAgents(supabase, args.workspaceId);
    if (agents.length === 0) return { scheduled: false, reason: "no_agent" };

    const { data: conversation, error } = await supabase
      .from("conversations")
      .select("agent_enabled, agent_paused_until")
      .eq("id", args.conversationId)
      .maybeSingle();
    if (error || !conversation) {
      if (error) console.error("[agent-dispatch] no pude leer la conversacion:", error.message);
      return { scheduled: false, reason: "error" };
    }

    // Nadie le pidio al agente que atienda esta conversacion.
    if (!conversation.agent_enabled) return { scheduled: false, reason: "not_enabled_here" };

    const state = resolveAgentState({ agents, channelId: args.channelId, conversation, now });
    const agentId = "agent" in state ? state.agent.id : null;
    const runBase = {
      workspaceId: args.workspaceId,
      source: "agent" as const,
      trigger: "inbound_message" as const,
      agentId,
      promptVersion: "agent" in state ? state.agent.promptVersion : null,
      conversationId: args.conversationId,
      contactId: args.contactId,
      channelId: args.channelId,
    };

    if (state.state !== "active") {
      const runId = await recordRunOutcome(supabase, { ...runBase, status: "skipped", statusDetail: state.state });
      return { scheduled: false, reason: state.state, runId };
    }

    // La automatizacion tiene prioridad: si reclamo el mensaje, el agente se
    // abstiene para ESTE mensaje y lo deja escrito.
    if (args.automation.claimed) {
      const runId = await recordRunOutcome(supabase, {
        ...runBase,
        status: "skipped_automation",
        statusDetail: args.automation.by,
      });
      return { scheduled: false, reason: "automation_claimed", runId };
    }

    // El turno lee la rafaga de messages. Si el guardado de entrantes de Zernio
    // esta apagado (Ajustes, 00053), no hay nada que leer y el agente quedaria
    // mudo sin explicacion: se deja el motivo escrito en vez de agendar.
    const { data: channelRow } = await supabase
      .from("channels")
      .select("provider, workspaces(persist_zernio_inbound)")
      .eq("id", args.channelId)
      .maybeSingle();
    const ws = channelRow?.workspaces as { persist_zernio_inbound: boolean } | { persist_zernio_inbound: boolean }[] | null | undefined;
    const persist = Array.isArray(ws) ? ws[0]?.persist_zernio_inbound : ws?.persist_zernio_inbound;
    if (channelRow?.provider === "zernio" && persist === false) {
      const runId = await recordRunOutcome(supabase, {
        ...runBase,
        status: "skipped",
        statusDetail: "message_persistence_off",
      });
      return { scheduled: false, reason: "message_persistence_off", runId };
    }

    const agent = state.agent;
    const timing = agentBurstTiming({
      lastMessageAt: now,
      bundleWindowSeconds: agent.bundleWindowSeconds,
      maxWaitSeconds: agent.maxWaitSeconds,
      now,
    });
    const payload: AgentBurstPayload = {
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      channelId: args.channelId,
      contactId: args.contactId,
      agentId: agent.id,
      last_message_at: now.toISOString(),
    };
    const job = await pushDebouncedJob(supabase, {
      type: AGENT_BURST_JOB,
      dedupeKey: agentBurstKey(args.conversationId),
      payload: payload as unknown as Record<string, unknown>,
      runAt: timing.runAt,
      deadline: timing.deadline,
    });
    return { scheduled: true, jobId: job.jobId, runAt: job.runAt, created: job.created };
  } catch (err) {
    console.error("[agent-dispatch] no pude agendar el turno:", err instanceof Error ? err.message : "error desconocido");
    return { scheduled: false, reason: "error" };
  }
}
