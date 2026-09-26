/**
 * Cuanto se lleva usado de cada integracion, contra la base.
 *
 * Aparte de `usage.ts` porque eso es puro y esto consulta: asi la aritmetica de
 * la barra se testea sin base y este archivo queda chico y obvio.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * Cuentas que ocupan un lugar del plan de Zernio.
 *
 * Hoy son los canales de la bandeja conectados por Zernio (Instagram). En el
 * bloque 2 se suman las cuentas de `social_accounts` que publican via Zernio
 * (TikTok), que ocupan lugar igual aunque no tengan bandeja: la cuenta se
 * conecta una sola vez y sirve para las dos cosas, asi que se cuenta por
 * cuenta (`late_account_id`), sin repetir.
 */
export async function countZernioAccounts(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("channels")
    .select("late_account_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "zernio")
    .eq("is_active", true);

  if (error) {
    // La barra de uso es informativa: si no se puede contar, la card se muestra
    // igual sin barra. Nunca vale romper la pantalla de integraciones por esto.
    console.error("[integrations] no pude contar las cuentas de Zernio:", error.message);
    return 0;
  }

  return new Set((data ?? []).map((row) => row.late_account_id)).size;
}

/**
 * Los numeros de uso de todas las integraciones del workspace, por id del
 * catalogo. Lo que no se cuenta todavia no aparece en el mapa, y la card se
 * dibuja sin barra.
 */
export async function countIntegrationUsage(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
): Promise<Record<string, number>> {
  return { zernio: await countZernioAccounts(supabase, workspaceId) };
}
