/**
 * La carga de «Sin vincular» (Extra L, AT3, F29).
 *
 * Todo con el cliente de QUIEN MIRA: la RLS de `contact_touches` deja ver un toque solo si se ve su
 * contacto (`can_see_contact`), asi que un Member con alcance propio solo ve los suyos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import {
  ambiguousKeys,
  buildUnlinkedRows,
  sinceFor,
  UNLINKED_PAGE_SIZE,
  type NameCounts,
  type UnlinkedRow,
  type UnlinkedTouch,
  type UnlinkedView,
} from "./unlinked-view";

type Db = SupabaseClient<Database>;

type MatchStatus = "manual" | "ignored" | "unmatched";

const COLUMNS =
  "id, contact_id, occurred_at, source, medium, origin, campaign, content_label, term, ad_id, adset_id, campaign_id, fbclid, meta_match_status, meta_match_method, meta_match_reason, meta_ad_id, meta_adset_id, meta_campaign_id";

export interface UnlinkedPage {
  rows: UnlinkedRow[];
  /** Cuantos hay en esta vista (para paginar). */
  total: number;
  /** Los contadores de las dos vistas. */
  counts: { unmatched: number; manual: number };
  page: number;
  pageSize: number;
}

export async function loadUnlinked(
  supabase: Db,
  params: { workspaceId: string; view: UnlinkedView; days: number; page: number; timeZone?: string; now?: Date },
): Promise<UnlinkedPage> {
  const now = params.now ?? new Date();
  const since = sinceFor(params.days, now);
  const statuses: MatchStatus[] = params.view === "manuales" ? ["manual", "ignored"] : ["unmatched"];
  const from = (params.page - 1) * UNLINKED_PAGE_SIZE;

  const countOf = async (list: MatchStatus[]) => {
    const { count } = await supabase
      .from("contact_touches")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", params.workspaceId)
      .in("meta_match_status", list)
      .gte("occurred_at", since);
    return count ?? 0;
  };

  const [unmatched, manual, pageResult] = await Promise.all([
    countOf(["unmatched"]),
    countOf(["manual", "ignored"]),
    supabase
      .from("contact_touches")
      .select(COLUMNS)
      .eq("workspace_id", params.workspaceId)
      .in("meta_match_status", statuses)
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .range(from, from + UNLINKED_PAGE_SIZE - 1),
  ]);

  const touches = (pageResult.data ?? []) as unknown as UnlinkedTouch[];

  // Los nombres de los contactos (la RLS decide cuales se ven).
  const contactIds = [...new Set(touches.map((t) => t.contact_id))];
  const contactNames: Record<string, string> = {};
  if (contactIds.length > 0) {
    const { data } = await supabase.from("contacts").select("id, display_name").in("id", contactIds);
    for (const c of (data ?? []) as Array<{ id: string; display_name: string | null }>) {
      if (c.display_name) contactNames[c.id] = c.display_name;
    }
  }

  // Cuantos anuncios o campañas comparten el nombre, para los toques de nombre ambiguo.
  const counts: NameCounts = { ads: {}, campaigns: {} };
  const keys = ambiguousKeys(touches);
  if (keys.ads.length > 0) {
    const { data } = await supabase.from("meta_ads").select("name_key").eq("workspace_id", params.workspaceId).in("name_key", keys.ads);
    for (const r of (data ?? []) as Array<{ name_key: string | null }>) if (r.name_key) counts.ads[r.name_key] = (counts.ads[r.name_key] ?? 0) + 1;
  }
  if (keys.campaigns.length > 0) {
    const { data } = await supabase.from("meta_campaigns").select("name_key").eq("workspace_id", params.workspaceId).in("name_key", keys.campaigns);
    for (const r of (data ?? []) as Array<{ name_key: string | null }>) if (r.name_key) counts.campaigns[r.name_key] = (counts.campaigns[r.name_key] ?? 0) + 1;
  }

  return {
    rows: buildUnlinkedRows({ touches, contactNames, counts, timeZone: params.timeZone }),
    total: params.view === "manuales" ? manual : unmatched,
    counts: { unmatched, manual },
    page: params.page,
    pageSize: UNLINKED_PAGE_SIZE,
  };
}
