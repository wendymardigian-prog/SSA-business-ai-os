import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { AiTaskDef } from "./catalog";
import type { TaskRunInfo } from "@/lib/background/screen";

type Db = SupabaseClient<Database>;

/**
 * La última corrida y el gasto del mes de UNA tarea (Bloque Agentes IA),
 * para cualquiera de las seis, no solo las cuatro de `BACKGROUND_TASKS`.
 * Mismo cálculo que `loadBackgroundScreen` (lib/background/screen-data.ts),
 * generalizado con el catálogo: el `source` (y, para la clasificación al
 * cierre, el filtro extra por `status_detail`) salen de `AI_TASKS`.
 *
 * Con service role: `cost_usd` no lo puede leer `authenticated` (00060).
 */
export async function loadTaskRunSummary(service: Db, workspaceId: string, task: AiTaskDef, now = new Date()): Promise<TaskRunInfo> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  let lastQuery = service
    .from("agent_runs")
    .select("status, status_detail, completed_at, created_at")
    .eq("workspace_id", workspaceId)
    .eq("source", task.source)
    .order("created_at", { ascending: false });
  if (task.detailLike) lastQuery = lastQuery.like("status_detail", task.detailLike);

  const [lastRes, costRes] = await Promise.all([
    lastQuery.limit(1).maybeSingle(),
    service.rpc("ai_cost_report", { p_workspace_id: workspaceId, p_from: monthStart, p_to: now.toISOString() }),
  ]);

  const last = lastRes.data as { status: string; status_detail: string | null; completed_at: string | null; created_at: string } | null;
  const report = costRes.data as { by_source?: Array<{ source?: string; cost_usd?: number }> } | null;
  // close_classification no tiene fila propia en by_source: comparte source con
  // conversation_summary, asi que su gasto no se puede separar (queda null, no 0).
  const spend = task.detailLike ? null : (report?.by_source ?? []).find((r) => r.source === task.source)?.cost_usd;

  return {
    at: last?.completed_at ?? last?.created_at ?? null,
    status: last?.status ?? null,
    detail: last?.status_detail ?? null,
    monthSpendUsd: spend === undefined || spend === null ? null : Number(spend),
  };
}
