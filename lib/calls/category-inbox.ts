/**
 * La bandeja de propuestas de categoria (F27): una LECTURA, nunca escribe.
 *
 * Lee con el cliente de servicio —despues de que quien llama haya comprobado
 * `calls.configure`— el id, la fecha y las cinco categorias de las llamadas
 * analizadas, y las agrupa con `groupCategoryProposals`. Lee solo esas cinco
 * ramas del analisis (no la transcripcion ni el resto).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { groupCategoryProposals, type CategoryProposal, type CategoryRow } from "./categories";
import type { CallCategories } from "./rubric";

type Db = SupabaseClient<Database>;

/** Cuantas llamadas analizadas mira la bandeja como maximo (las mas recientes). */
export const INBOX_MAX_CALLS = 2000;

export async function loadCategoryProposals(service: Db, workspaceId: string, categories: CallCategories): Promise<CategoryProposal[]> {
  const { data, error } = await service
    .from("calls")
    .select(
      "id, recorded_at, dolor:analysis->dolor, deseo:analysis->deseo, objecion:analysis->objecion, razon_compra:analysis->razon_compra, razon_no_compra:analysis->razon_no_compra",
    )
    .eq("workspace_id", workspaceId)
    .eq("analysis_status", "analyzed")
    .is("archived_at", null)
    .order("recorded_at", { ascending: false })
    .limit(INBOX_MAX_CALLS);
  if (error || !data) {
    if (error) console.error("[llamadas] no pude leer las propuestas de categoría:", error.message);
    return [];
  }
  const rows: CategoryRow[] = (data as unknown as Array<{ id: string; recorded_at: string } & Record<string, unknown>>).map((r) => ({
    id: r.id,
    recorded_at: r.recorded_at,
    analysis: { dolor: r.dolor, deseo: r.deseo, objecion: r.objecion, razon_compra: r.razon_compra, razon_no_compra: r.razon_no_compra },
  }));
  return groupCategoryProposals(rows, categories);
}
