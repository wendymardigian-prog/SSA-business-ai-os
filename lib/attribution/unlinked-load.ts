/**
 * La carga de «Sin vincular» (Extra L, AT3, F29).
 *
 * Todo con el cliente de QUIEN MIRA: la RLS de `contact_touches` deja ver un toque solo si se ve su
 * contacto (`can_see_contact`), asi que un Member con alcance propio solo ve los suyos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { touchMetaIds } from "./meta-link";
import { loadMetaNamesByIds } from "./meta-names";
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

const COLUMNS =
  "id, contact_id, occurred_at, source, medium, origin, campaign, content_label, term, ad_id, adset_id, campaign_id, fbclid, meta_match_status, meta_match_method, meta_match_reason, meta_ad_id, meta_adset_id, meta_campaign_id, dedupe_key, raw";

export interface UnlinkedPage {
  rows: UnlinkedRow[];
  /** Cuantos hay en esta vista (para paginar). */
  total: number;
  /** Los contadores de las tres vistas. */
  counts: { unmatched: number; noAd: number; manual: number };
  page: number;
  pageSize: number;
}

export async function loadUnlinked(
  supabase: Db,
  params: { workspaceId: string; view: UnlinkedView; days: number; page: number; timeZone?: string; now?: Date },
): Promise<UnlinkedPage> {
  const now = params.now ?? new Date();
  const since = sinceFor(params.days, now);
  const from = (params.page - 1) * UNLINKED_PAGE_SIZE;

  // «Hechos a mano» lleva `meta_match_by`: un `ignored` automatico (contenido organico) no lo hizo una persona.
  const head = () =>
    supabase.from("contact_touches").select("id", { count: "exact", head: true }).eq("workspace_id", params.workspaceId).gte("occurred_at", since);

  let pageQuery = supabase.from("contact_touches").select(COLUMNS).eq("workspace_id", params.workspaceId).gte("occurred_at", since);
  if (params.view === "manuales") pageQuery = pageQuery.in("meta_match_status", ["manual", "ignored"]).not("meta_match_by", "is", null);
  else if (params.view === "sin-anuncio") pageQuery = pageQuery.eq("meta_match_status", "matched").is("meta_ad_id", null);
  else pageQuery = pageQuery.eq("meta_match_status", "unmatched");

  const [unmatchedRes, noAdRes, manualRes, pageResult] = await Promise.all([
    head().eq("meta_match_status", "unmatched"),
    head().eq("meta_match_status", "matched").is("meta_ad_id", null),
    head().in("meta_match_status", ["manual", "ignored"]).not("meta_match_by", "is", null),
    pageQuery.order("occurred_at", { ascending: false }).range(from, from + UNLINKED_PAGE_SIZE - 1),
  ]);
  const unmatched = unmatchedRes.count ?? 0;
  const noAd = noAdRes.count ?? 0;
  const manual = manualRes.count ?? 0;

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

  // Con la sesion: sin permiso sobre el catalogo, la RLS no devuelve nada y se ven los ids.
  const names = await loadMetaNamesByIds(supabase as unknown as SupabaseClient, params.workspaceId, touches.map(touchMetaIds));

  return {
    rows: buildUnlinkedRows({ touches, contactNames, counts, timeZone: params.timeZone, names }),
    total: params.view === "manuales" ? manual : params.view === "sin-anuncio" ? noAd : unmatched,
    counts: { unmatched, noAd, manual },
    page: params.page,
    pageSize: UNLINKED_PAGE_SIZE,
  };
}
