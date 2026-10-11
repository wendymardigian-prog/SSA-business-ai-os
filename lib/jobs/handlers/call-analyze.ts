/**
 * El job `call_analyze` (F22): analiza UNA llamada. Fino a proposito: la logica
 * vive en `lib/calls/analyze-run.ts`.
 *
 * Igual que `call_classify`, no lanza por un fallo del modelo: la corrida
 * reagenda o deja la llamada en un estado que una persona ve.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { runCallAnalysisJob, type AnalyzeJobPayload } from "@/lib/calls/analyze-run";

export const CALL_ANALYZE_JOB = "call_analyze";

export async function handleCallAnalyze(ctx: JobContext): Promise<void> {
  const payload = ctx.job.payload as Partial<AnalyzeJobPayload>;
  if (!payload.callId) {
    console.error("[call_analyze] el job no trae la llamada");
    return;
  }
  try {
    const result = await runCallAnalysisJob({ db: ctx.supabase as SupabaseClient<Database> }, payload as AnalyzeJobPayload);
    console.log(`[call_analyze] ${result.outcome}`);
  } catch (err) {
    console.error("[call_analyze] fallo inesperado:", err instanceof Error ? err.message : "error");
    throw err;
  }
}

export function registerCallAnalyzeHandler(): void {
  registerJobHandler(CALL_ANALYZE_JOB, handleCallAnalyze);
}
