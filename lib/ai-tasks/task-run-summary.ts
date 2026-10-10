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

  const [costRes, ...rest] = await Promise.all([
    service.rpc("ai_cost_report", { p_workspace_id: workspaceId, p_from: monthStart, p_to: now.toISOString() }),
    ...tasks.map(lastRun),
    // Una tarea sin source propio (la clasificación al cierre) no tiene fila
    // en by_source: su gasto se suma aparte, con el mismo filtro que Corridas.
    ...tasks.map((task) => (task.detailLike ? sumMonth(service, workspaceId, task, monthStart, now) : Promise.resolve(null))),
  ]);
  const lastResults = rest.slice(0, tasks.length) as Array<{ data: unknown }>;
  const ownSums = rest.slice(tasks.length) as Array<{ runs: number; costUsd: number } | null>;
  const report = costRes.data as { by_source?: Array<{ source?: string; runs?: number; cost_usd?: number }> } | null;

  return tasks.map((task, i) => {
    const last = lastResults[i].data as { status: string; status_detail: string | null; completed_at: string | null; created_at: string } | null;
    const fromReport = (report?.by_source ?? []).find((r) => r.source === task.source);
    const own = ownSums[i];
    const spend = task.detailLike ? (own?.costUsd ?? null) : fromReport?.cost_usd;
    const runs = task.detailLike ? (own?.runs ?? null) : report ? (fromReport?.runs ?? 0) : null;
    return {
      at: last?.completed_at ?? last?.created_at ?? null,
      status: last?.status ?? null,
      detail: last?.status_detail ?? null,
      monthSpendUsd: spend === undefined || spend === null ? null : Number(spend),
      monthRuns: runs,
    };
  });
}

/**
 * Corridas y gasto del mes de una tarea filtrada por `status_detail`, de a
 * paginas (PostgREST devuelve 1000 filas como maximo). null si falla: mejor
 * "no se sabe" que un cero falso.
 */
async function sumMonth(service: Db, workspaceId: string, task: AiTaskDef, from: string, now: Date): Promise<{ runs: number; costUsd: number } | null> {
  const PAGE = 1000;
  let runs = 0;
  let costUsd = 0;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await service
      .from("agent_runs")
      .select("cost_usd")
      .eq("workspace_id", workspaceId)
      .eq("source", task.source)
      .like("status_detail", task.detailLike!)
      .gte("created_at", from)
      .lt("created_at", now.toISOString())
      .neq("status", "running")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error(`[ai-tasks] no pude sumar el gasto de ${task.id}:`, error.message);
      return null;
    }
    const rows = (data ?? []) as Array<{ cost_usd: number | string | null }>;
    runs += rows.length;
    for (const r of rows) costUsd += Number(r.cost_usd ?? 0);
    if (rows.length < PAGE) return { runs, costUsd };
  }
}
