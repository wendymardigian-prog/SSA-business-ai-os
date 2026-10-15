/**
 * Lee `workspaces.attribution_settings` (SOLO servidor, con el cliente de servicio o el del usuario). NUNCA lanza: ante
 * cualquier falla devuelve los valores por defecto, así un comentario o un DM no se frenan por no poder leer la configuración.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { defaultAttributionSettings, parseAttributionSettings, type AttributionSettings } from "./settings";

export async function loadAttributionSettings(db: SupabaseClient<Database>, workspaceId: string): Promise<AttributionSettings> {
  try {
    const { data, error } = await db.from("workspaces").select("attribution_settings").eq("id", workspaceId).maybeSingle();
    if (error) return defaultAttributionSettings();
    return parseAttributionSettings((data as { attribution_settings?: unknown } | null)?.attribution_settings);
  } catch {
    return defaultAttributionSettings();
  }
}
