"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types/database";
import { canRetryStep } from "@/lib/flows/runs";
import { buildNodeMetrics, isMetricPeriod, periodRange, type NodeMetrics, type NodeStatRow } from "@/lib/flows/node-metrics";
import { PROVIDER_RETRY_VAR } from "@/lib/flow-engine/provider-retry";

/**
 * Las metricas de cada paso en el lienzo y «Reintentar desde este paso» en las ejecuciones (00316).
 *
 * Las metricas se leen con la sesion de quien mira (`flow_node_stats` es SECURITY INVOKER: la RLS decide que cuenta).
 * Reintentar pide `flows.edit`, comprueba con la sesion que la ejecucion se ve y es de este negocio, y recien despues
 * escribe con el cliente de servicio.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FlowMetricsResult = { ok: true; metrics: Record<string, NodeMetrics> } | { ok: false; error: string };

export async function loadFlowNodeMetrics(input: { flowId: string; period: string }): Promise<FlowMetricsResult> {
  if (!UUID.test(input.flowId) || !isMetricPeriod(input.period)) return { ok: false, error: "El pedido no es válido." };
  const ctx = await getPermissionAction("flows.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para ver automatizaciones." };

  const { data: flow } = await ctx.supabase.from("flows").select("id").eq("id", input.flowId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!flow) return { ok: false, error: "No encontré esa automatización." };

  const { from, to } = periodRange(input.period);
  const { data, error } = await ctx.supabase.rpc("flow_node_stats", { p_flow_id: input.flowId, p_from: from, p_to: to });
  if (error) {
    console.error(`[flows] no pude leer las metricas de los pasos (code=${error.code ?? "?"})`);
    return { ok: false, error: "No pude leer las métricas. Probá de nuevo en un rato." };
  }
  return { ok: true, metrics: buildNodeMetrics((data ?? []) as unknown as NodeStatRow[]) };
}

export type RetryStepResult = { ok: true } | { ok: false; error: string };

/**
 * Vuelve a correr una ejecucion desde el paso que fallo. La sesion se reabre en ese paso y un `resume_flow` con
 * `rerunNode` la despierta (el mismo camino que un paso que quedo para despues). Un reclamo condicional sobre el
 * estado evita dos reintentos con doble clic.
 */
export async function retryFlowStep(input: { flowId: string; runId: string; stepId: string }): Promise<RetryStepResult> {
  if (![input.flowId, input.runId, input.stepId].every((id) => UUID.test(id))) return { ok: false, error: "El pedido no es válido." };
  const ctx = await getPermissionAction("flows.edit");
  if (!ctx) return { ok: false, error: "No tenés permiso para editar automatizaciones." };

  // Con la sesion: que se vea y que sea de este negocio.
  const { data: flow } = await ctx.supabase.from("flows").select("id, status").eq("id", input.flowId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!flow) return { ok: false, error: "No encontré esa automatización." };
  if ((flow as { status: string }).status !== "published") return { ok: false, error: "La automatización no está publicada: publicala para reintentar." };

  const { data: run } = await ctx.supabase
    .from("flow_sessions")
    .select("id, status, created_at, contact_id, channel_id")
    .eq("id", input.runId)
    .eq("flow_id", input.flowId)
    .maybeSingle();
  if (!run) return { ok: false, error: "No encontré esa ejecución." };

  const { data: steps } = await ctx.supabase
    .from("flow_session_steps")
    .select("id, node_id, node_type, status, error_kind, started_at, seq")
    .eq("session_id", input.runId)
    .order("started_at", { ascending: true })
    .order("seq", { ascending: true })
    .limit(500);
  const list = (steps ?? []) as Array<{ id: string; node_id: string; node_type: string; status: string; error_kind: string | null }>;
  const step = list.find((s) => s.id === input.stepId);
  if (!step) return { ok: false, error: "No encontré ese paso." };
  const lastFailure = [...list].reverse().find((s) => s.status === "failed");

  const runRow = run as { id: string; status: string; created_at: string; contact_id: string | null; channel_id: string | null };
  const allowed = canRetryStep({
    stepStatus: step.status,
    errorKind: step.error_kind,
    nodeType: step.node_type,
    isLastFailure: lastFailure?.id === step.id,
    runStatus: runRow.status,
    runCreatedAt: runRow.created_at,
  });
  if (!allowed.ok) return { ok: false, error: allowed.reason };

  const service = await createServiceClient();

  // El paso tiene que seguir existiendo en lo que esta publicado.
  const { data: published } = await service.from("flows").select("nodes").eq("id", input.flowId).maybeSingle();
  const nodes = ((published as { nodes?: unknown } | null)?.nodes ?? []) as Array<{ id?: string }>;
  if (!nodes.some((n) => n?.id === step.node_id)) return { ok: false, error: "Ese paso ya no está en la automatización publicada." };

  const { data: session } = await service.from("flow_sessions").select("variables").eq("id", runRow.id).maybeSingle();
  const variables = { ...(((session as { variables?: unknown } | null)?.variables ?? {}) as Record<string, unknown>) };
  // Un reintento a mano arranca la cuenta de reintentos automaticos de cero.
  delete variables[PROVIDER_RETRY_VAR];

  let conversationId: string | null = null;
  if (runRow.contact_id && runRow.channel_id) {
    const { data: conversation } = await service
      .from("conversations")
      .select("id")
      .eq("channel_id", runRow.channel_id)
      .eq("contact_id", runRow.contact_id)
      .maybeSingle();
    conversationId = (conversation as { id?: string } | null)?.id ?? null;
  }

  const runAt = new Date().toISOString();
  // El reclamo: solo una vuelta pasa de terminada a activa.
  const { data: claimed, error: claimError } = await service
    .from("flow_sessions")
    .update({
      status: "active",
      current_node_id: step.node_id,
      waiting_until: runAt,
      waiting_for_input: false,
      finished_at: null,
      end_reason: null,
      error_message: null,
      has_failed_step: false,
      variables: variables as Json,
    } as never)
    .eq("id", runRow.id)
    .eq("status", runRow.status as never)
    .select("id");
  if (claimError) {
    console.error(`[flows] no pude reabrir la ejecucion (code=${claimError.code ?? "?"})`);
    return { ok: false, error: "No pude reintentar. Probá de nuevo en un rato." };
  }
  if (!claimed || claimed.length === 0) return { ok: false, error: "Esa ejecución ya se está reintentando." };

  const { error: jobError } = await service.from("scheduled_jobs").insert({
    type: "resume_flow",
    payload: {
      sessionId: runRow.id,
      nodeId: step.node_id,
      flowId: input.flowId,
      channelId: runRow.channel_id,
      contactId: runRow.contact_id,
      conversationId,
      workspaceId: ctx.workspace.id,
      variables,
      rerunNode: true,
    } as unknown as Json,
    run_at: runAt,
  });
  if (jobError) {
    // Sin el job nadie la despierta: se vuelve a cerrar como estaba.
    console.error(`[flows] no pude agendar el reintento (code=${jobError.code ?? "?"})`);
    await service.from("flow_sessions").update({ status: runRow.status, has_failed_step: true } as never).eq("id", runRow.id);
    return { ok: false, error: "No pude reintentar. Probá de nuevo en un rato." };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "flow",
    entityId: input.flowId,
    action: "update",
    metadata: { kind: "step_retry", run_id: runRow.id, node_id: step.node_id, node_type: step.node_type },
    performedBy: ctx.user.id,
  });

  revalidatePath(`/dashboard/flows/${input.flowId}/ejecuciones`);
  return { ok: true };
}
