/**
 * Los nombres y la rúbrica de los niveles de calificación del workspace, para
 * las pantallas del servidor (la ficha, la bandeja, la lista). Solo de servidor:
 * usa el cliente de servicio filtrado por el workspace que pasa quien llama
 * (el de la sesión). Los nombres no son un secreto: cualquier miembro los ve.
 *
 * Nunca lanza: ante un error, los nombres por defecto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createServiceClient } from "@/lib/supabase/server";
import { parseQualificationSettings, type QualificationSettings } from "./qualification";

export async function loadQualificationSettings(
  workspaceId: string,
  client?: SupabaseClient<Database>,
): Promise<QualificationSettings> {
  try {
    const service = client ?? (await createServiceClient());
    const { data, error } = await service
      .from("workspaces")
      .select("qualification_settings")
      .eq("id", workspaceId)
      .maybeSingle();
    if (error) console.error("[qualification] no pude leer los niveles:", error.message);
    return parseQualificationSettings((data as { qualification_settings?: unknown } | null)?.qualification_settings);
  } catch (err) {
    console.error("[qualification] no pude leer los niveles:", err instanceof Error ? err.message : err);
    return parseQualificationSettings(null);
  }
}
