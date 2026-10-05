/**
 * Sincronizar las cuentas sociales después de un cambio de integración (F74).
 *
 * Es el único punto por el que los disparadores llaman a `syncSocialAccounts`.
 * Nunca lanza: si la sincronización falla, se registra el error y se devuelve
 * como aviso para que la persona lo vea. El guardado o la desconexión que la
 * disparó ya quedaron hechos, y no se deshacen por esto.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
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
    return result.warnings;
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    console.error(`[social] sincronizar cuentas (${motivo}) fallo:`, detalle);
    return ["No pude actualizar las cuentas sociales. Probá \"Sincronizar cuentas\" en Integraciones."];
  }
}
