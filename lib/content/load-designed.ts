/**
 * Las piezas del tablero que tienen un diseño del Diseñador IA vinculado (DS8, F65): para el destello de la tarjeta.
 *
 * Se lee con el cliente de quien mira: la RLS de `designs` pide el permiso de ver diseños, así que quien no lo tiene
 * no ve el destello (y por eso ni se pregunta). Va de a páginas porque PostgREST corta en 1000 filas sin avisar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

const PAGE = 1000;
const MAX_PAGES = 10;

export async function loadDesignedPieceIds(supabase: SupabaseClient<Database>, workspaceId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("designs")
      .select("content_post_id")
      .eq("workspace_id", workspaceId)
      .not("content_post_id", "is", null)
      .is("archived_at", null)
      .order("id")
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) {
      // Sin el dato la tarjeta se ve como siempre: no tumba el tablero.
      console.error("[content] no pude leer las piezas con diseño:", error.code ?? "error");
      break;
    }
    const rows = (data ?? []) as Array<{ content_post_id: string | null }>;
    for (const row of rows) if (row.content_post_id) ids.add(row.content_post_id);
    if (rows.length < PAGE) break;
  }
  return ids;
}
