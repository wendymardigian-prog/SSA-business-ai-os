/**
 * Lee los pilares y ofertas del negocio para las pantallas de contenido (F91).
 *
 * Los trae TODOS, archivados incluidos: una idea o pieza que ya tiene un pilar
 * lo sigue mostrando aunque se haya archivado, y quien arma el selector
 * (`selectableItems`) decide que ofrecer. Lo usan el tablero, el editor y, mas
 * adelante, los drawers: leerlo en un solo lugar evita que cada pantalla lo
 * arme distinto.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { TaxonomyItem } from "./taxonomy";

type Db = SupabaseClient<Database>;

export interface ContentTaxonomy {
  pillars: TaxonomyItem[];
  offers: TaxonomyItem[];
  /** Si quien mira puede crear uno desde el selector (`settings.manage`). */
  canCreate: boolean;
}

export async function loadContentTaxonomy(
  supabase: Db,
  workspaceId: string,
  canCreate: boolean,
): Promise<ContentTaxonomy> {
  const [pillarsRes, offersRes] = await Promise.all([
    supabase.from("content_pillars").select("id, name, color, archived_at").eq("workspace_id", workspaceId),
    supabase.from("content_offers").select("id, name, archived_at").eq("workspace_id", workspaceId),
  ]);

  if (pillarsRes.error) console.error("[content] no pude leer los pilares:", pillarsRes.error.message);
  if (offersRes.error) console.error("[content] no pude leer las ofertas:", offersRes.error.message);

  return {
    pillars: (pillarsRes.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      archivedAt: p.archived_at,
    })),
    offers: (offersRes.data ?? []).map((o) => ({ id: o.id, name: o.name, archivedAt: o.archived_at })),
    canCreate,
  };
}
