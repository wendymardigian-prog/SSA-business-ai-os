/**
 * Sincronizar las cuentas sociales después de un cambio de integración (F74).
 *
 * Es el único punto por el que los disparadores llaman a `syncSocialAccounts`.
 * Nunca lanza: si la sincronización falla, se registra el error y se devuelve
 * como aviso para que la persona lo vea. El guardado o la desconexión que la
 * disparó ya quedaron hechos, y no se deshacen por esto.
 *
 * Si la sincronización conectó una red nueva, encola su primera lectura de
 * métricas en el momento: si no, la pantalla de Social queda vacía hasta el
 * cron de las 3 AM.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createServiceClient } from "@/lib/supabase/server";
import { queueMetricsSync } from "@/lib/metrics/queue";
import { syncSocialAccounts } from "./accounts";

type Db = SupabaseClient<Database>;

/** Las integraciones que cambian qué cuentas sociales existen. */
export const SOCIAL_PROVIDER_IDS = ["zernio", "postproxy", "google", "linkedin", "threads"];

export async function syncAccountsAfterChange(
  supabase: Db,
  workspaceId: string,
  motivo: string,
): Promise<string[]> {
  try {
    const result = await syncSocialAccounts(supabase, workspaceId);
    await queueFirstRead(workspaceId, result.newAccountIds, motivo);
    return result.warnings;
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    console.error(`[social] sincronizar cuentas (${motivo}) fallo:`, detalle);
    return ["No pude actualizar las cuentas sociales. Probá \"Sincronizar cuentas\" en Integraciones."];
  }
}

/**
 * La primera lectura de las cuentas recien conectadas. Nunca lanza: si no se
 * pudo encolar, la cuenta queda conectada igual y la lee el cron de la noche
 * (o el boton "Actualizar").
 */
export async function queueFirstRead(
  workspaceId: string,
  accountIds: string[],
  motivo: string,
): Promise<void> {
  if (accountIds.length === 0) return;
  try {
    // La cola es interna y esta cerrada a los usuarios (00046).
    const service = await createServiceClient();
    await queueMetricsSync(service, workspaceId, accountIds, new Date());
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    console.error(`[social] no pude encolar la primera lectura (${motivo}):`, detalle);
  }
}
