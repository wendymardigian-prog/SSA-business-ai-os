/**
 * Que el pilar y la oferta que llegan existan de verdad (F91).
 *
 * La base ya garantiza que el id exista (clave foranea), pero no que sea de
 * ESTE workspace ni que no este archivado: un id de otro negocio o de un pilar
 * ya dado de baja entraria sin queja. Lo revisa el servidor antes de escribir.
 *
 * Un archivado se acepta solo si es el que la fila YA tiene: guardar una
 * pieza vieja no puede fallar porque su pilar se archivo despues.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

export type RefsCheck = { ok: true } | { ok: false; error: string };

const TABLES = [
  { key: "pillar_id", table: "content_pillars", label: "pilar", article: "ese", fem: false },
  { key: "offer_id", table: "content_offers", label: "oferta", article: "esa", fem: true },
] as const;

export async function checkTaxonomyRefs(
  supabase: Db,
  workspaceId: string,
  refs: { pillar_id?: string | null; offer_id?: string | null },
  current: { pillar_id?: string | null; offer_id?: string | null } = {},
): Promise<RefsCheck> {
  for (const { key, table, label, article, fem } of TABLES) {
    const id = refs[key];
    if (!id) continue;

    const { data } = await supabase
      .from(table)
      .select("id, archived_at")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!data) return { ok: false, error: `No encontre ${article} ${label}` };

    if (data.archived_at && current[key] !== id) {
      return {
        ok: false,
        error: `${article[0].toUpperCase()}${article.slice(1)} ${label} está archivad${fem ? "a" : "o"}. Elegí otr${fem ? "a" : "o"}.`,
      };
    }
  }

  return { ok: true };
}
