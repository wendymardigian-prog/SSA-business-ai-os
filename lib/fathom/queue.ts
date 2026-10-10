/**
 * La cola de sincronizacion de Fathom (F8, F10).
 *
 * El cron SQL `fathom-sync` (00146) encola un job `fathom_sync` por conexion
 * activa cada 10 minutos. "Sincronizar ahora" y las continuaciones del handler
 * usan este modulo, con LA MISMA clave de dedupe que la funcion SQL, asi que
 * los tres caminos se pisan entre si en vez de duplicarse.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { scheduleJob } from "@/lib/scheduler";
import type { Database } from "@/lib/types/database";

export const FATHOM_SYNC_JOB = "fathom_sync";
/** El ancho de la franja de dedupe, en segundos: 10 minutos como el cron. */
export const SYNC_SLOT_SECONDS = 600;

/** Misma cuenta que `floor(extract(epoch from now()) / 600)` de la funcion SQL. */
export function fathomSyncDedupeKey(connectionId: string, now: Date = new Date()): string {
  return `${FATHOM_SYNC_JOB}:${connectionId}:${Math.floor(now.getTime() / 1000 / SYNC_SLOT_SECONDS)}`;
}

/** Prefijo para buscar CUALQUIER job de sincronizacion de esa conexion. */
export function fathomSyncKeyPrefix(connectionId: string): string {
  return `${FATHOM_SYNC_JOB}:${connectionId}:`;
}

type Service = SupabaseClient<Database>;

export type QueueResult = { queued: true } | { queued: false; reason: "already" | "error"; error?: string };

/**
 * Encola una sincronizacion de esa conexion a la hora dada. Si ya hay un job
 * `pending` o `processing` de esa conexion, NO encola otro.
 */
export async function queueFathomSync(
  service: Service,
  connectionId: string,
  opts: { runAt?: Date; now?: Date; ignoreProcessing?: boolean } = {},
): Promise<QueueResult> {
  const now = opts.now ?? new Date();
  try {
    const { data: existing } = await service
      .from("scheduled_jobs")
      .select("id, status")
      .eq("type", FATHOM_SYNC_JOB)
      .like("dedupe_key", `${fathomSyncKeyPrefix(connectionId)}%`)
      .in("status", opts.ignoreProcessing ? ["pending"] : ["pending", "processing"]);
    if ((existing ?? []).length > 0) return { queued: false, reason: "already" };

    await scheduleJob(service, FATHOM_SYNC_JOB, { connectionId }, opts.runAt ?? now, fathomSyncDedupeKey(connectionId, now));
    return { queued: true };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    // 23505: otro proceso lo encolo justo antes (el unico de dedupe_key).
    if (e.code === "23505") return { queued: false, reason: "already" };
    return { queued: false, reason: "error", error: e.message ?? "no se pudo encolar" };
  }
}

/** Para la conexion recien hecha y para "Sincronizar ahora": ahora mismo. Nunca lanza. */
export async function queueFathomSyncNow(service: Service, connectionId: string, now: Date = new Date()): Promise<QueueResult> {
  return queueFathomSync(service, connectionId, { runAt: now, now });
}

/**
 * La continuacion de una corrida que se quedo sin presupuesto o recibio un 429.
 * El job que la pide esta `processing`, asi que solo cuenta como duplicado otro
 * `pending`.
 */
export async function requeueFathomSync(service: Service, connectionId: string, delayMs: number, now: Date = new Date()): Promise<QueueResult> {
  return queueFathomSync(service, connectionId, { runAt: new Date(now.getTime() + delayMs), now, ignoreProcessing: true });
}
