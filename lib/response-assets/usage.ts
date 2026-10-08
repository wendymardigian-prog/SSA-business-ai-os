/**
 * Contar el uso de un recurso desde el servidor (el agente, la aprobacion de
 * un borrador). Pasa por touch_response_asset (00132), que con el service
 * client cuenta cualquier recurso y con el de un usuario solo los de su
 * workspace.
 *
 * Nunca lanza ni devuelve error: el contador es un lujo, el mensaje es el
 * trabajo. Se llama DESPUES de mandar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export async function touchAssetUsage(supabase: SupabaseClient<Database>, assetId: string): Promise<void> {
  try {
    const { error } = await supabase.rpc("touch_response_asset", { p_asset_id: assetId });
    if (error) console.error("[response-assets] no pude contar el uso:", error.message);
  } catch (err) {
    console.error("[response-assets] no pude contar el uso:", err instanceof Error ? err.message : err);
  }
}
