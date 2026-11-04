/**
 * Volver a correr un paso mas tarde (la guardia de entrega, 00287).
 *
 * Un email de marketing que hoy no entra en el tope del negocio (o con el freno puesto) NO falla ni se pierde: el paso
 * agenda un `resume_flow` con `rerunNode: true` para `retryAt` y la sesion queda dormida en ESE paso. Al despertar,
 * `resumeSession` corre el mismo paso otra vez (no el siguiente) y la guardia vuelve a decidir.
 *
 * Mismo mecanismo que el "Esperar" (`nodes/delay.ts`): un job en `scheduled_jobs` y `waiting_until` en la sesion.
 * Queda una linea `node_deferred` en el historial (sin datos personales: el paso y el motivo).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import type { FlowExecutionContext } from "./types";
import type { DeferReason } from "@/lib/email/delivery-guard";

/** La variable de la sesion donde un paso recuerda a quienes ya les mando antes de quedar para despues. */
export const DEFERRED_SENT_VAR = "__deferred_sent";

export async function deferFlowNode(
  supabase: SupabaseClient<Database>,
  args: {
    nodeId: string;
    nodeType: string;
    sessionId: string;
    context: FlowExecutionContext;
    retryAt: Date;
    reason: DeferReason;
    /** Direcciones a las que el paso YA mando en esta corrida: al volver no se les manda de nuevo. */
    alreadySent?: string[];
  },
): Promise<"pause"> {
  const { context, nodeId, sessionId } = args;

  // Lo que ya salio en esta corrida queda en la sesion (resumeSession restaura las variables desde ahi).
  const variables = { ...(context.variables ?? {}) } as Record<string, unknown>;
  const prior = (variables[DEFERRED_SENT_VAR] ?? {}) as Record<string, string[]>;
  if (args.alreadySent && args.alreadySent.length > 0) {
    variables[DEFERRED_SENT_VAR] = { ...prior, [nodeId]: [...new Set([...(prior[nodeId] ?? []), ...args.alreadySent])] };
  }
  context.variables = variables as FlowExecutionContext["variables"];

  const runAt = args.retryAt.toISOString();
  const { error } = await supabase.from("scheduled_jobs").insert({
    type: "resume_flow",
    payload: {
      sessionId,
      nodeId,
      flowId: context.flowId,
      channelId: context.channelId,
      contactId: context.contactId,
      ...(context.contactId ? {} : { memberUserId: context.memberUserId ?? null }),
      conversationId: context.conversationId,
      workspaceId: context.workspaceId,
      lateConversationId: context.lateConversationId || null,
      lateAccountId: context.lateAccountId || null,
      variables,
      // Vuelve a correr ESTE paso (no el siguiente).
      rerunNode: true,
    } as unknown as Json,
    run_at: runAt,
  });
  // Sin el job nadie despierta la sesion: que falle a la vista (el motor cancela la sesion y lo anota).
  if (error) throw new Error(`no pude dejar para despues el paso ${nodeId}: ${error.message}`);

  await supabase
    .from("flow_sessions")
    .update({ waiting_until: runAt, current_node_id: nodeId, variables: variables as Json })
    .eq("id", sessionId);

  await supabase.from("analytics_events").insert({
    workspace_id: context.workspaceId,
    flow_id: context.flowId,
    contact_id: context.contactId,
    event_type: "node_deferred",
    metadata: { nodeId, nodeType: args.nodeType, reason: args.reason, retryAt: runAt },
  });

  return "pause";
}

/** A quienes este paso ya les mando antes de quedar para despues (y lo borra de la sesion: se usa una vez). */
export function takeAlreadySent(context: FlowExecutionContext, nodeId: string): Set<string> {
  const variables = (context.variables ?? {}) as Record<string, unknown>;
  const all = (variables[DEFERRED_SENT_VAR] ?? {}) as Record<string, string[]>;
  const sent = new Set((all[nodeId] ?? []).map((a) => a.toLowerCase()));
  if (all[nodeId]) {
    const rest = { ...all };
    delete rest[nodeId];
    if (Object.keys(rest).length > 0) variables[DEFERRED_SENT_VAR] = rest;
    else delete variables[DEFERRED_SENT_VAR];
  }
  return sent;
}
