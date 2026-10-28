/**
 * Los trabajos de la importacion de conversaciones de Zernio (00267).
 *
 * Toda la logica esta en `lib/inbox-import/run.ts` (y las reglas, puras, en
 * `lib/inbox-import/state.ts`). Estos handlers solo validan el payload: ninguno
 * lanza por un fallo de Zernio (la cola reintentaria a los 10 segundos encima de
 * la espera propia de 1, 5 y 15 minutos).
 */

import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import {
  INBOX_IMPORT_JOB,
  INBOX_IMPORT_PASS_JOB,
  runInboxImportPass,
  runInboxImportStep,
  type InboxImportPassPayload,
  type InboxImportStepPayload,
} from "@/lib/inbox-import/run";

async function handleInboxImport({ supabase, job }: JobContext): Promise<void> {
  const payload = (job.payload ?? {}) as Partial<InboxImportStepPayload>;
  if (!payload.workspaceId || !payload.channelId || !payload.runId || typeof payload.step !== "number") {
    throw new Error(`job ${job.id} de importacion de conversaciones con el payload incompleto`);
  }
  const outcome = await runInboxImportStep(supabase, payload as InboxImportStepPayload);
  if (outcome !== "continued") {
    console.log(`[inbox-import] canal ${payload.channelId}, vuelta ${payload.step}: ${outcome}`);
  }
}

async function handleInboxImportPass({ supabase, job }: JobContext): Promise<void> {
  const payload = (job.payload ?? {}) as Partial<InboxImportPassPayload>;
  if (!payload.workspaceId || !payload.channelId || ![2, 3].includes(payload.pass as number)) {
    throw new Error(`job ${job.id} de pasada de importacion con el payload incompleto`);
  }
  const result = await runInboxImportPass(supabase, payload as InboxImportPassPayload);
  console.log(
    `[inbox-import] canal ${payload.channelId}, pasada ${payload.pass}: ` +
      (result.started ? "arranco" : `no arranco (${result.reason})`),
  );
}

export function registerInboxImportHandlers(): void {
  registerJobHandler(INBOX_IMPORT_JOB, handleInboxImport);
  registerJobHandler(INBOX_IMPORT_PASS_JOB, handleInboxImportPass);
}
