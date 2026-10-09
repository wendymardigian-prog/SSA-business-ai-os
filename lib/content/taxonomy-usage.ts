/**
 * Cuantas piezas usa cada pilar y cada producto, para las pantallas donde se
 * administran (Ajustes -> Productos y el ⚙️ de Contenido).
 *
 * De a paginas: PostgREST corta en 1000 filas sin avisar, y un conteo que se
 * queda corto en silencio es peor que no tener conteo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

/** El pilar y el producto de cada pieza que tiene alguno de los dos. */
export async function pieceClassification(
  supabase: Db,
  workspaceId: string,
): Promise<Array<{ pillar_id: string | null; offer_id: string | null }>> {
  const rows: Array<{ pillar_id: string | null; offer_id: string | null }> = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("content_posts")
      .select("pillar_id, offer_id")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .or("pillar_id.not.is.null,offer_id.not.is.null")
      .order("id")
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) {
      console.error("[taxonomy-usage] no pude contar las piezas:", error.message);
      break;
    }
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
  }

  return rows;
}
