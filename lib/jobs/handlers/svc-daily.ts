// @plantilla-quitar(servicios)
/**
 * El job `svc_daily` (Servicios A1, F88): el barrido diario de UN negocio (repeticiones, Retos de fecha fija, pasos
 * vencidos, semáforo, accesos y mora, renovados que llegan a su fin, accesos por vencer y vencidos, «faltó», «reanudar
 * sola», servicios que empiezan, «está por terminar» y la purga de la comunidad). Lo encola la base
 * (`private.enqueue_svc_daily`, cron `svc-daily` por SQL directo), uno por día y por negocio con el módulo prendido.
 *
 * Todo pasa en `app_servicio.svc_daily_run`, cada paso en su bloque: un paso que falla no frena a los demás. Si alguno
 * falló, el job lanza AL FINAL (la cola lo reintenta y repetirlo no duplica nada).
 */
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { svcRpc } from "@/lib/services/db";
import { enqueuePortalDigests, enqueuePortalDueToday } from "@/lib/jobs/handlers/portal-digest";
import { syncWorkspaceSeries } from "@/lib/scheduling/series/run";

export const SVC_DAILY_JOB = "svc_daily";

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function runSvcDaily({ supabase, job }: JobContext): Promise<void> {
  const p = (job.payload ?? {}) as { workspace_id?: unknown; local_date?: unknown };
  if (!isUuid(p.workspace_id)) return;
  const res = await svcRpc<{ errors?: string[] }>(supabase, "svc_daily_run", { p_workspace_id: p.workspace_id });
  if (!res.ok) throw new Error(`svc_daily_run: ${res.error.message}`);
  const errors = res.data?.errors ?? [];
  // A3 (F128): los lunes, el resumen semanal del estudiante (solo los programas que lo tienen prendido).
  if (typeof p.local_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.local_date)) {
    try {
      await enqueuePortalDigests(supabase, p.workspace_id, p.local_date);
    } catch (e) {
      errors.push(`portal_digest: ${e instanceof Error ? e.message : String(e)}`);
    }
    // A3 (F128): «Lo que vence hoy» por email, todos los días (solo programas y personas que lo prendieron).
    try {
      await enqueuePortalDueToday(supabase, p.workspace_id, p.local_date);
    } catch (e) {
      errors.push(`portal_due_today: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // 00524: las fechas de las series de reuniones de las próximas semanas, como reuniones de la plataforma. Un problema de
  // Google no hace reintentar todo el barrido (la cola lo repetiría encima): se anota y se reintenta mañana.
  try {
    const problems = await syncWorkspaceSeries(supabase, p.workspace_id);
    if (problems.length > 0) console.warn(`[series] ${problems.length} serie(s) no se pudieron leer de Google hoy`);
  } catch (e) {
    console.warn("[series] no pude revisar las series de reuniones:", e instanceof Error ? e.name : "error");
  }
  if (errors.length > 0) throw new Error(`svc_daily: ${errors.length} paso(s) fallaron: ${errors.map((e) => e.split(":")[0]).join(", ")}`);
}

export function registerSvcDailyHandler(): void {
  registerJobHandler(SVC_DAILY_JOB, runSvcDaily);
}
