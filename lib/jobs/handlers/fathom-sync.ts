/**
 * El job `fathom_sync` (F8): una consulta a Fathom de UNA conexion.
 *
 * Lo encola el cron SQL `fathom-sync` cada 10 minutos (`private.enqueue_fathom_sync`,
 * 00146), "Sincronizar ahora" y las propias continuaciones. Es fino a
 * proposito: la logica vive en `lib/fathom/ingest.ts`, que recibe todo por
 * parametro y se prueba sin red.
 *
 * NO lanza por un problema de Fathom: la ingesta ya sabe que hacer con un 429,
 * un 5xx o un acceso cortado (reencolar, anotar el error o avisar a la
 * persona). Si lanzara, la cola reintentaria a los 10 segundos encima de la
 * espera propia. Lo inesperado se anota en `sync_last_error` y se reintenta en
 * la proxima vuelta del cron.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { syncFathomConnection } from "@/lib/fathom/ingest";
import { FATHOM_SYNC_JOB } from "@/lib/fathom/queue";
import { emitCallEvent } from "@/lib/calls/automation/emit";

type Db = SupabaseClient<Database>;

export async function handleFathomSync(ctx: JobContext): Promise<void> {
  const connectionId = (ctx.job.payload as { connectionId?: string }).connectionId;
  if (!connectionId) {
    console.error("[fathom_sync] el job no trae la conexión");
    return;
  }
  const service = ctx.supabase as Db;
  try {
    // Una llamada nueva que queda vinculada a un contacto dispara los flujos de `call_linked`.
    const result = await syncFathomConnection({ supabase: service, onLinked: async ({ callId }) => void (await emitCallEvent(service, "call_linked", callId)) }, connectionId);
    // Solo numeros y el resultado: nunca titulos, correos ni transcripciones.
    console.log(`[fathom_sync] ${result.outcome} · nuevas ${result.ingested} · ya estaban ${result.skippedExisting} · de otros ${result.skippedNotCloser} · pedidos ${result.requests}`);
  } catch (err) {
    console.error("[fathom_sync] fallo inesperado:", err instanceof Error ? err.message : "error");
    await service.from("oauth_connections").update({ sync_last_error: "Falló la consulta a Fathom" }).eq("id", connectionId);
  }
}

export function registerFathomSyncHandler(): void {
  registerJobHandler(FATHOM_SYNC_JOB, handleFathomSync);
}
