/**
 * El job de «Importar miembros» de un grupo de WhatsApp. Toda la logica esta en `lib/whatsapp-groups/import.ts`;
 * este handler solo valida el payload. No lanza por un fallo de Evolution (reagenda a 1, 5 y 15 minutos).
 */

import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { GROUP_IMPORT_JOB, runGroupImport, type GroupImportPayload } from "@/lib/whatsapp-groups/import";

async function handleGroupImport({ supabase, job }: JobContext): Promise<void> {
  const payload = (job.payload ?? {}) as Partial<GroupImportPayload>;
  if (!payload.workspaceId || !payload.groupId) {
    throw new Error(`job ${job.id} de importar miembros con el payload incompleto`);
  }
  const outcome = await runGroupImport(supabase, { requestedBy: null, ...payload } as GroupImportPayload);
  console.log(`[grupos] importar miembros del grupo ${payload.groupId}: ${outcome}`);
}

export function registerWhatsappGroupImportHandler(): void {
  registerJobHandler(GROUP_IMPORT_JOB, handleGroupImport);
}
