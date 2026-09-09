import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { DelayNodeData } from "../types";

const MULTIPLIERS: Record<string, number> = {
  seconds: 1000,
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
};

/**
 * Espera un tiempo fijo y sigue.
 *
 * El flow no se queda esperando en memoria: se agenda un job y la sesion queda
 * dormida. Quien la despierta es /api/cron/jobs, que desde la migracion 00036
 * corre por pg_cron. Sin ese cron andando, un Delay para el flow para siempre.
 */
export const delayNode: NodeDefinition<DelayNodeData> = {
  type: "delay",
  label: "Esperar",
  async execute({ supabase, data, context, node, sessionId }: NodeExecutionArgs<DelayNodeData>) {
    const delayMs = data.duration * (MULTIPLIERS[data.unit] || 1000);
    const runAt = new Date(Date.now() + delayMs).toISOString();

    await supabase.from("scheduled_jobs").insert({
      type: "resume_flow",
      payload: {
        sessionId,
        nodeId: node.id,
        flowId: context.flowId,
        channelId: context.channelId,
        contactId: context.contactId,
        conversationId: context.conversationId,
        workspaceId: context.workspaceId,
        lateConversationId: context.lateConversationId || null,
        lateAccountId: context.lateAccountId || null,
        variables: context.variables || {},
      },
      run_at: runAt,
    });

    await supabase
      .from("flow_sessions")
      .update({ waiting_until: runAt, current_node_id: node.id })
      .eq("id", sessionId);

    return "pause";
  },
};

/**
 * Espera a que el contacto conteste algo.
 *
 * A diferencia de Delay no hay reloj: la sesion queda marcada esperando input y
 * la despierta el proximo mensaje entrante, via resumeSession.
 */
export const smartDelayNode: NodeDefinition<unknown> = {
  type: "smartDelay",
  label: "Esperar respuesta",
  aliases: [{ nodeType: "action", actionType: "smartDelay" }],
  async execute({ supabase, node, sessionId }: NodeExecutionArgs<unknown>) {
    await supabase
      .from("flow_sessions")
      .update({ waiting_for_input: true, current_node_id: node.id })
      .eq("id", sessionId);

    return "pause";
  },
};
