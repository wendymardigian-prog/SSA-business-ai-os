/**
 * El trabajo de la importacion del historial de WhatsApp. Toda la logica esta en
 * `lib/whatsapp-history/run-import.ts`: este handler solo valida el payload.
 */

import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import {
  runWhatsappImportStep,
  WHATSAPP_HISTORY_IMPORT_JOB,
  type WhatsappImportPayload,
} from "@/lib/whatsapp-history/run-import";

async function handleWhatsappHistoryImport({ supabase, job }: JobContext): Promise<void> {
  const payload = (job.payload ?? {}) as Partial<WhatsappImportPayload>;
  if (!payload.workspaceId || !payload.channelId || !payload.runId || typeof payload.step !== "number") {
    throw new Error(`job ${job.id} de importacion de historial con el payload incompleto`);
  }
  const outcome = await runWhatsappImportStep(supabase, payload as WhatsappImportPayload);
  if (outcome !== "continued") {
    console.log(`[whatsapp-import] canal ${payload.channelId}, vuelta ${payload.step}: ${outcome}`);
  }
}

export function registerWhatsappHistoryImportHandler(): void {
  registerJobHandler(WHATSAPP_HISTORY_IMPORT_JOB, handleWhatsappHistoryImport);
}
