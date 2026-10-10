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
  const [summary] = await loadTaskRunSummaries(service, workspaceId, [task], now);
  return summary;
}

/**
 * Lo mismo para varias tareas a la vez, con UN solo reporte de costos. La
 * lista de Agentes IA pedia el mismo `ai_cost_report` (el mes entero del
 * workspace, lo mas pesado de la pantalla) una vez por tarea: siete veces
 * identicas.
 */
export async function loadTaskRunSummaries(service: Db, workspaceId: string, tasks: AiTaskDef[], now = new Date()): Promise<TaskRunInfo[]> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const lastRun = (task: AiTaskDef) => {
    let q = service
      .from("agent_runs")
      .select("status, status_detail, completed_at, created_at")
      .eq("workspace_id", workspaceId)
      .eq("source", task.source)
      .order("created_at", { ascending: false });
    if (task.detailLike) q = q.like("status_detail", task.detailLike);
    return q.limit(1).maybeSingle();
  };

  const [costRes, ...lastResults] = await Promise.all([
    service.rpc("ai_cost_report", { p_workspace_id: workspaceId, p_from: monthStart, p_to: now.toISOString() }),
    ...tasks.map(lastRun),
  ]);
  const report = costRes.data as { by_source?: Array<{ source?: string; cost_usd?: number }> } | null;

  return tasks.map((task, i) => {
    const last = lastResults[i].data as { status: string; status_detail: string | null; completed_at: string | null; created_at: string } | null;
    // close_classification no tiene fila propia en by_source: comparte source con
    // conversation_summary, asi que su gasto no se puede separar (queda null, no 0).
    const spend = task.detailLike ? null : (report?.by_source ?? []).find((r) => r.source === task.source)?.cost_usd;
    return {
      at: last?.completed_at ?? last?.created_at ?? null,
      status: last?.status ?? null,
      detail: last?.status_detail ?? null,
      monthSpendUsd: spend === undefined || spend === null ? null : Number(spend),
    };
  });
}
