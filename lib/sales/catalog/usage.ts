/**
 * Cuántas ventas se hicieron con una versión (plano F6): lo que impide borrar una versión que
 * ya se vendió. Cuenta TODAS las ventas del workspace, no solo las que ve quien mira (un rol con
 * alcance `own` y `settings.manage` vería un número chico y borraría de más), así que lee con el
 * cliente de servicio. Solo servidor, y solo devuelve conteos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";

export async function versionSalesCounts(_supabase: SupabaseClient, versionIds: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = Object.fromEntries(versionIds.map((id) => [id, 0]));
  if (versionIds.length === 0) return counts;
  const service = await createServiceClient();
  const { data, error } = await service.from("sales").select("product_version_id").in("product_version_id", [...versionIds]).limit(10_000);
  if (error) {
    console.error("[catalog] no pude contar las ventas por versión:", error.message);
    return counts;
  }
  for (const row of data ?? []) counts[row.product_version_id] = (counts[row.product_version_id] ?? 0) + 1;
  return counts;
}
