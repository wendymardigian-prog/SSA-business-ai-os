/**
 * El job `call_summary` (F29): resume UNA llamada. Fino a proposito: la logica
 * vive en `lib/calls/summary-run.ts`. No lanza por un fallo del modelo (la corrida
 * reagenda a 1, 5 y 15 minutos o deja `summary_status = 'error'`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { runCallSummaryJob, type SummaryJobPayload } from "@/lib/calls/summary-run";

export const CALL_SUMMARY_JOB = "call_summary";

export async function handleCallSummary(ctx: JobContext): Promise<void> {
  const payload = ctx.job.payload as Partial<SummaryJobPayload>;
  if (!payload.callId) {
    console.error("[call_summary] el job no trae la llamada");
    return;
  }
  try {
    const result = await runCallSummaryJob({ db: ctx.supabase as SupabaseClient<Database> }, payload as SummaryJobPayload);
    console.log(`[call_summary] ${result.outcome}`);
  } catch (err) {
    console.error("[call_summary] fallo inesperado:", err instanceof Error ? err.message : "error");
    throw err;
  }
}

export function registerCallSummaryHandler(): void {
  registerJobHandler(CALL_SUMMARY_JOB, handleCallSummary);
}
