import { requirePermission } from "@/lib/auth/guards";
import { countUsage } from "@/lib/content/taxonomy";
import { ContenidoView, type TaxonomyRow } from "./contenido-view";

/**
 * Pilares y ofertas del contenido (F89).
 *
 * Pide `settings.manage` y no "ser admin": un rol personalizado con ese
 * permiso entra, y un admin al que se lo sacaron no. La RLS de la 00116 lo
 * repite en la base.
 */

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

/**
 * Los pilares y ofertas que usa cada pieza, de a paginas: PostgREST corta en
 * 1000 filas sin avisar, y un conteo que se queda corto en silencio es peor
 * que no tener conteo.
 */
async function pieceClassification(
  supabase: Awaited<ReturnType<typeof requirePermission>>["supabase"],
  workspaceId: string,
) {
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
      console.error("[settings/contenido] no pude contar las piezas:", error.message);
      break;
    }
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
  }

  return rows;
}

export default async function ContenidoSettingsPage() {
  const { workspace, supabase } = await requirePermission("settings.manage");

  const [{ data: pillars }, { data: offers }, classified] = await Promise.all([
    supabase
      .from("content_pillars")
      .select("id, name, color, archived_at")
      .eq("workspace_id", workspace.id)
      .order("name"),
    supabase
      .from("content_offers")
      .select("id, name, archived_at")
      .eq("workspace_id", workspace.id)
      .order("name"),
    pieceClassification(supabase, workspace.id),
  ]);

  const pillarUse = countUsage(classified.map((r) => r.pillar_id));
  const offerUse = countUsage(classified.map((r) => r.offer_id));

  const toRow = (
    row: { id: string; name: string; color?: string | null; archived_at: string | null },
    uses: Map<string, number>,
  ): TaxonomyRow => ({
    id: row.id,
    name: row.name,
    color: row.color ?? null,
    archived: row.archived_at !== null,
    pieces: uses.get(row.id) ?? 0,
  });

  return (
    <ContenidoView
      pillars={(pillars ?? []).map((p) => toRow(p, pillarUse))}
      offers={(offers ?? []).map((o) => toRow(o, offerUse))}
    />
  );
}
