import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { logAudit } from "@/lib/audit";

/**
 * Pausar y reanudar el agente de IA desde un flow (Fase 3, F32).
 *
 * El caso de uso: el agente esta atendiendo, entra una keyword de promo, el
 * flow toma el control ("pausar agente"), hace su parte y lo devuelve
 * ("reanudar agente").
 *
 * La pausa vive en conversations.agent_paused_until, separada del toggle
 * (agent_enabled) a proposito: el toggle es la decision de una persona, la
 * pausa es de un flow. Reanudar solo levanta la pausa; si nadie habia prendido
 * el agente en esa conversacion, sigue apagado.
 */

export interface PauseAgentNodeData {
  /** Minutos de pausa. Vacio = hasta que un flow lo reanude. */
  minutes?: number | null;
}

const MAX_PAUSE_MINUTES = 60 * 24 * 30;

export const pauseAgentNode: NodeDefinition<PauseAgentNodeData> = {
  type: "pauseAgent",
  label: "Pausar agente de IA",
  aliases: [{ nodeType: "action", actionType: "pauseAgent" }],
  async execute({ supabase, data, context }: NodeExecutionArgs<PauseAgentNodeData>) {
    if (!context.conversationId) return;
    const minutes = Number(data?.minutes);
    const until =
      Number.isFinite(minutes) && minutes > 0
        ? new Date(Date.now() + Math.min(minutes, MAX_PAUSE_MINUTES) * 60_000).toISOString()
        : "infinity";

    const { error } = await supabase
      .from("conversations")
      .update({ agent_paused_until: until })
      .eq("id", context.conversationId);
    if (error) {
      console.error("[flow:pauseAgent] no pude pausar el agente:", error.message);
      return;
    }

    await logAudit({
      supabase,
      workspaceId: context.workspaceId,
      entityType: "conversation",
      entityId: context.conversationId,
      action: "agent_paused",
      changes: { agent_paused_until: { old: null, new: until } },
      metadata: { flow_id: context.flowId },
    });
  },
};

export const resumeAgentNode: NodeDefinition<unknown> = {
  type: "resumeAgent",
  label: "Reanudar agente de IA",
  aliases: [{ nodeType: "action", actionType: "resumeAgent" }],
  async execute({ supabase, context }: NodeExecutionArgs<unknown>) {
    if (!context.conversationId) return;
    const { data: before } = await supabase
      .from("conversations")
      .select("agent_paused_until")
      .eq("id", context.conversationId)
      .maybeSingle();

    const { error } = await supabase
      .from("conversations")
      .update({ agent_paused_until: null })
      .eq("id", context.conversationId);
    if (error) {
      console.error("[flow:resumeAgent] no pude reanudar el agente:", error.message);
      return;
    }

    await logAudit({
      supabase,
      workspaceId: context.workspaceId,
      entityType: "conversation",
      entityId: context.conversationId,
      action: "agent_resumed",
      changes: { agent_paused_until: { old: before?.agent_paused_until ?? null, new: null } },
      metadata: { flow_id: context.flowId },
    });
  },
};
