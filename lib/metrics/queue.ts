/**
 * Encolar la lectura de metricas de una o varias cuentas (F47).
 *
 * Es el unico lugar que arma el job: lo usan el cron de las 3 AM, el boton
 * "Actualizar" y la lectura al conectar una red nueva. Los tres tienen que
 * compartir la clave de dedupe, o el boton apretado justo despues de conectar
 * encolaria una segunda lectura de la misma cuenta.
 *
 * `service` TIENE que ser un service client: la cola esta cerrada a los
 * usuarios (00046).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { scheduleJob } from "@/lib/scheduler";
import { METRICS_SYNC_JOB } from "@/lib/jobs/handlers/metrics-sync";

type Db = SupabaseClient<Database>;

export interface QueueResult {
  /** Cuentas con un job nuevo. */
  queued: number;
  /** Cuentas que ya tenian uno pendiente de esta hora: no hace falta otro. */
  alreadyQueued: number;
}

/** Una cuenta, una lectura por hora (UTC): la clave que respeta el unico de 00061. */
export function metricsSyncKey(accountId: string, now: Date): string {
  return `metrics:${accountId}:${now.toISOString().slice(0, 13)}`;
}

/**
 * Encola una lectura por cuenta. Un 23505 (ya habia una pendiente con la misma
 * clave) es el comportamiento buscado y cuenta como `alreadyQueued`. Cualquier
 * otro error lanza: quien llama decide si eso tumba algo o no.
 */
export async function queueMetricsSync(
  service: Db,
  workspaceId: string,
  accountIds: string[],
  now: Date,
): Promise<QueueResult> {
  const result: QueueResult = { queued: 0, alreadyQueued: 0 };

  for (const socialAccountId of accountIds) {
    try {
      await scheduleJob(
        service,
        METRICS_SYNC_JOB,
        { workspaceId, socialAccountId },
        now,
        metricsSyncKey(socialAccountId, now),
      );
      result.queued += 1;
    } catch (err) {
      if ((err as { code?: string } | null)?.code === "23505") {
        result.alreadyQueued += 1;
        continue;
      }
      throw err;
    }
  }

  return result;
}
