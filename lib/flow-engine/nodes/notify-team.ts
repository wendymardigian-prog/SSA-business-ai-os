/**
 * "Avisar en la campana" (E15): una notificación para personas del equipo. Sirve en un
 * flujo sin contacto (un reporte de fin de día) y también en uno con contacto.
 *
 * - A quién: las personas elegidas, "quien envió el reporte" (la persona del flujo sin
 *   contacto), o las dos cosas. Solo llega a quien es del workspace.
 * - El título y el texto admiten variables (`{{member.name}}`, `{{metrics.total.links_enviados}}`).
 * - Nunca lanza: un aviso que no se pudo crear no frena el flujo (`createNotification`
 *   ya no lanza).
 */
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { FlowExecutionContext } from "../types";
import { interpolateVariables } from "../interpolate";
import { createNotification } from "@/lib/notifications/create";

export interface NotifyTeamNodeData {
  /** `users`: las elegidas. `reporter`: quien envió el reporte. `both`: las dos. */
  to?: "users" | "reporter" | "both";
  userIds?: string[];
  title?: string;
  body?: string;
}

export const NOTIFY_TITLE_MAX = 200;
export const NOTIFY_BODY_MAX = 1000;

/** A quiénes va, sin repetir. Puro. */
export function notifyRecipients(data: NotifyTeamNodeData, memberUserId: string | null | undefined): string[] {
  const to = data.to ?? "users";
  const out = new Set<string>();
  if (to === "users" || to === "both") for (const id of data.userIds ?? []) out.add(id);
  if ((to === "reporter" || to === "both") && memberUserId) out.add(memberUserId);
  return [...out];
}

async function execute({ supabase, data, context, node }: NodeExecutionArgs<NotifyTeamNodeData, FlowExecutionContext>) {
  const vars = context.variables ?? {};
  const title = interpolateVariables(data.title ?? "", vars).trim().slice(0, NOTIFY_TITLE_MAX);
  const body = interpolateVariables(data.body ?? "", vars).trim().slice(0, NOTIFY_BODY_MAX);
  if (!title) {
    console.warn(`[flow-engine] el nodo ${node.id} no tiene título: no se avisa`);
    return;
  }

  const wanted = notifyRecipients(data, context.memberUserId);
  if (wanted.length === 0) return;
  const { data: members } = await supabase.from("workspace_members").select("user_id").eq("workspace_id", context.workspaceId).in("user_id", wanted);
  const allowed = (members ?? []).map((m) => m.user_id);

  // Un reporte de fin de día abre su detalle; si no, el flujo.
  const report = (vars.report ?? null) as { id?: unknown; form_id?: unknown } | null;
  const reportId = typeof report?.id === "string" ? report.id : null;
  const formId = typeof report?.form_id === "string" ? report.form_id : null;

  for (const recipientId of allowed) {
    await createNotification({
      supabase,
      workspaceId: context.workspaceId,
      type: "flow_notice",
      title,
      body: body || undefined,
      entityType: reportId && formId ? "eod_report" : "flow",
      entityId: reportId && formId ? reportId : context.flowId,
      recipientId,
      metadata: { flow_id: context.flowId, node_id: node.id, ...(formId ? { form_id: formId } : {}) },
    });
  }
}

export const notifyTeamNode: NodeDefinition<NotifyTeamNodeData> = {
  needsContact: false,
  type: "notify_team",
  label: "Avisar en la campana",
  aliases: [{ nodeType: "action", actionType: "notify_team" }],
  execute,
};
