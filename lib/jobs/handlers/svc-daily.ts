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

export const SVC_DAILY_JOB = "svc_daily";

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function runSvcDaily({ supabase, job }: JobContext): Promise<void> {
  const p = (job.payload ?? {}) as { workspace_id?: unknown };
  if (!isUuid(p.workspace_id)) return;
  const res = await svcRpc<{ errors?: string[] }>(supabase, "svc_daily_run", { p_workspace_id: p.workspace_id });
  if (!res.ok) throw new Error(`svc_daily_run: ${res.error.message}`);
  const errors = res.data?.errors ?? [];
  if (errors.length > 0) throw new Error(`svc_daily: ${errors.length} paso(s) fallaron: ${errors.map((e) => e.split(":")[0]).join(", ")}`);
}

export function registerSvcDailyHandler(): void {
  registerJobHandler(SVC_DAILY_JOB, runSvcDaily);
}
