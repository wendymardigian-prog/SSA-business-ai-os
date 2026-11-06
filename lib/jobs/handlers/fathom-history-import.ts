/**
 * El job `fathom_history_import`: una vuelta de la importacion del historial de
 * UNA conexion. Es fino a proposito: la logica vive en `lib/fathom/history-import.ts`.
 *
 * Se reencola solo mientras quede trabajo. No lanza por un problema de Fathom (la
 * importacion ya sabe esperar o quedar incompleta); un error de la base guardando el
 * avance si, y la cola lo reintenta.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { FATHOM_HISTORY_IMPORT_JOB, runFathomHistoryImport, type FathomHistoryPayload } from "@/lib/fathom/history-import";

type Db = SupabaseClient<Database>;

export async function handleFathomHistoryImport(ctx: JobContext): Promise<void> {
  const payload = ctx.job.payload as Partial<FathomHistoryPayload>;
  if (!payload.connectionId || !payload.runId || typeof payload.step !== "number") {
    console.error("[fathom_history_import] el job no trae la conexión o la corrida");
    return;
  }
  const outcome = await runFathomHistoryImport(
    { supabase: ctx.supabase as Db },
    { connectionId: payload.connectionId, runId: payload.runId, step: payload.step },
  );
  // Solo el resultado: nunca titulos, correos ni transcripciones.
  console.log(`[fathom_history_import] ${outcome}`);
}

export function registerFathomHistoryImportHandler(): void {
  registerJobHandler(FATHOM_HISTORY_IMPORT_JOB, handleFathomHistoryImport);
}
