/**
 * El job que manda un evento a la API de Conversiones de Meta (00328).
 *
 * Toda la lógica está en `lib/meta/capi/run.ts`. Este handler solo valida el payload: ni este ni aquel lanzan por un
 * fallo de Meta (la cola reintentaría a los 10 segundos encima del reintento propio de 1, 5 y 15 minutos). Solo lanza
 * si no puede leer la base.
 */

import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { META_CAPI_JOB, runCapiSend, type CapiSendPayload } from "@/lib/meta/capi/run";

async function handleMetaCapiSend({ supabase, job }: JobContext): Promise<void> {
  const payload = (job.payload ?? {}) as Partial<CapiSendPayload>;
  if (typeof payload.eventLogId !== "string" || !payload.eventLogId) {
    throw new Error(`job ${job.id} de la API de Conversiones sin el evento`);
  }
  const attempt = typeof payload.attempt === "number" && payload.attempt >= 1 ? payload.attempt : 1;
  const outcome = await runCapiSend(supabase, { eventLogId: payload.eventLogId, attempt });
  console.log(`[meta-capi] evento ${payload.eventLogId}: ${outcome}`);
}

export function registerMetaCapiHandler(): void {
  registerJobHandler(META_CAPI_JOB, handleMetaCapiSend);
}
