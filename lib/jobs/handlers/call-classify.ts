/**
 * El job `call_classify` (F17): clasifica UNA llamada. Fino a proposito: la
 * logica vive en `lib/calls/classify-run.ts`.
 *
 * NO lanza por un fallo del modelo: la propia corrida reagenda (1, 5 y 15
 * minutos) o deja la llamada "Por revisar". Si lanzara, la cola reintentaria a
 * los 10 segundos encima de esa espera.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { runCallClassification } from "@/lib/calls/classify-run";

export const CALL_CLASSIFY_JOB = "call_classify";

export async function handleCallClassify(ctx: JobContext): Promise<void> {
  const payload = ctx.job.payload as { callId?: string; retry?: number };
  if (!payload.callId) {
    console.error("[call_classify] el job no trae la llamada");
    return;
  }
  try {
    const result = await runCallClassification({ db: ctx.supabase as SupabaseClient<Database> }, payload.callId, payload.retry ?? 0);
    console.log(`[call_classify] ${result.outcome}`);
  } catch (err) {
    // Algo inesperado (la base, no el modelo): la cola lo reintenta.
    console.error("[call_classify] fallo inesperado:", err instanceof Error ? err.message : "error");
    throw err;
  }
}

export function registerCallClassifyHandler(): void {
  registerJobHandler(CALL_CLASSIFY_JOB, handleCallClassify);
}
