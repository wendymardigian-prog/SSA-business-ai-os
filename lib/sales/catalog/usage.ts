/**
 * Cuántas ventas se hicieron con una versión (plano F6). Hasta que exista la
 * tabla `sales` (00162, Bloque 3) la cuenta es 0; F17 reemplaza esto por la
 * consulta real sobre `sales.product_version_id`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function versionSalesCounts(_supabase: SupabaseClient, versionIds: readonly string[]): Promise<Record<string, number>> {
  return Object.fromEntries(versionIds.map((id) => [id, 0]));
}
