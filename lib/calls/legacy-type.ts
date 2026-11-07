/**
 * La clave vieja de tipo de una grabacion, sacada de lo que tiene hoy: su area, su tipo y la marca
 * de no show. No se guarda desde la 00308. Decide que no se resume, que nunca va a Conocimiento y
 * los filtros de los flujos viejos.
 *
 * Lanza si no puede leer las areas: sin saber el area, una reunion de equipo podria pasar por una
 * de cualquier otra. Quien llama decide que hacer ante eso.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { legacyCallTypeFor, readCategorySnapshot } from "./catalog";

type Db = SupabaseClient<Database>;

export async function derivedCallType(
  db: Db,
  workspaceId: string,
  call: { category_snapshot?: unknown; no_show?: boolean | null },
): Promise<string | null> {
  if (call.no_show === true) return "no_show";
  const snapshot = readCategorySnapshot(call.category_snapshot);
  if (!snapshot) return null;
  const { data, error } = await db.from("booking_categories").select("id, system_key").eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  return legacyCallTypeFor(snapshot, data ?? []);
}
