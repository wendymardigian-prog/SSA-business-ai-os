/**
 * La carga de «Sin vincular» (Extra L, AT3, F29; agrupada desde la 00318).
 *
 * Todo con el cliente de QUIEN MIRA: la RLS de `contact_touches` deja ver un toque solo si se ve su
 * contacto (`can_see_contact`), asi que un Member con alcance propio solo ve los suyos. Lo mismo las
 * reuniones y las ventas con las que se mide el impacto de cada grupo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { REVIEW_METHODS } from "./meta-match";
import { touchMetaIds } from "./meta-link";
import { loadMetaNamesByIds } from "./meta-names";
import {
  ambiguousKeys,
  buildRuleRows,
  buildUnlinkedRows,
  firstAndLastTouch,
  groupUnlinked,
  ruleKeyOf,
  sinceFor,
  UNLINKED_GROUPS_PER_PAGE,
  type ContactFacts,
  type MetaRuleRecord,
  type NameCounts,
  type RuleRow,
  type UnlinkedGroup,
  type UnlinkedTouch,
  type UnlinkedView,
} from "./unlinked-view";

type Db = SupabaseClient<Database>;

const COLUMNS =
  "id, contact_id, occurred_at, source, medium, origin, campaign, content_label, term, ad_id, adset_id, campaign_id, fbclid, meta_match_status, meta_match_method, meta_match_reason, meta_ad_id, meta_adset_id, meta_campaign_id, dedupe_key, raw";

/** Cuantos toques se leen como maximo para agrupar (los mas recientes). */
export const UNLINKED_MAX_TOUCHES = 2000;
/** PostgREST manda el `in` en la URL: de a tandas. */
const IDS_PER_QUERY = 150;

const REVIEW_LIST = `(${REVIEW_METHODS.join(",")})`;

export interface UnlinkedCounts {
  unmatched: number;
  review: number;
  noAd: number;
  rules: number;
  manual: number;
}

export interface UnlinkedPage {
  groups: UnlinkedGroup[];
  rules: RuleRow[];
  /** Cuantos grupos hay en esta vista (para paginar). */
  total: number;
  /** Cuantos toques hay en esta vista (lo que dice la pestaña). */
  touches: number;
  /** Se leyeron todos los toques del periodo, o se corto en `UNLINKED_MAX_TOUCHES`. */
  truncated: boolean;
  counts: UnlinkedCounts;
  page: number;
  pageSize: number;
}

const chunks = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Lo que hace falta de una consulta de PostgREST para filtrarla por vista (sirve igual para contar y para leer). */
interface Filterable<Q> {
  eq(column: string, value: string): Q;
  in(column: string, values: string[]): Q;
  is(column: string, value: null): Q;
  not(column: string, operator: string, value: string | null): Q;
}

/** El filtro de cada vista. «Hechos a mano» lleva `meta_match_by`: lo automatico no lo hizo una persona. */
function forView<Q extends Filterable<Q>>(query: Q, view: Exclude<UnlinkedView, "reglas">): Q {
  if (view === "manuales") return query.in("meta_match_status", ["manual", "ignored"]).not("meta_match_by", "is", null);
  if (view === "revisar") return query.eq("meta_match_status", "matched").in("meta_match_method", [...REVIEW_METHODS]);
  if (view === "sin-anuncio") return query.eq("meta_match_status", "matched").is("meta_ad_id", null).not("meta_match_method", "in", REVIEW_LIST);
  return query.eq("meta_match_status", "unmatched");
}

export async function loadUnlinked(
  supabase: Db,
  params: { workspaceId: string; view: UnlinkedView; days: number; page: number; timeZone?: string; now?: Date },
): Promise<UnlinkedPage> {
  const now = params.now ?? new Date();
  const since = sinceFor(params.days, now);

  const head = () =>
    supabase.from("contact_touches").select("id", { count: "exact", head: true }).eq("workspace_id", params.workspaceId).gte("occurred_at", since);

  const [unmatchedRes, reviewRes, noAdRes, manualRes, rulesRes] = await Promise.all([
    forView(head(), "sin-vincular"),
    forView(head(), "revisar"),
    forView(head(), "sin-anuncio"),
    forView(head(), "manuales"),
    supabase.from("meta_match_rules").select("id", { count: "exact", head: true }).eq("workspace_id", params.workspaceId),
  ]);
  const counts: UnlinkedCounts = {
    unmatched: unmatchedRes.count ?? 0,
    review: reviewRes.count ?? 0,
    noAd: noAdRes.count ?? 0,
    manual: manualRes.count ?? 0,
    rules: rulesRes.count ?? 0,
  };

  if (params.view === "reglas") {
    const rules = await loadRules(supabase, params.workspaceId, params.timeZone);
    return { groups: [], rules, total: rules.length, touches: 0, truncated: false, counts, page: 1, pageSize: rules.length || 1 };
  }

  const pageResult = await forView(
    supabase.from("contact_touches").select(COLUMNS).eq("workspace_id", params.workspaceId).gte("occurred_at", since),
    params.view,
  )
    .order("occurred_at", { ascending: false })
    .limit(UNLINKED_MAX_TOUCHES);
  if (pageResult.error) console.error("[sin-vincular] no pude leer los toques:", pageResult.error.message);
  const touches = (pageResult.data ?? []) as unknown as UnlinkedTouch[];

  const contactIds = [...new Set(touches.map((t) => t.contact_id))];
  const [contactNames, facts, names, nameCounts] = await Promise.all([
    loadContactNames(supabase, contactIds),
    loadContactFacts(supabase, params.workspaceId, contactIds),
    // Con la sesion: sin permiso sobre el catalogo, la RLS no devuelve nada y se ven los ids.
    loadMetaNamesByIds(supabase as unknown as SupabaseClient, params.workspaceId, touches.map(touchMetaIds)),
    loadNameCounts(supabase, params.workspaceId, touches),
  ]);

  const rows = buildUnlinkedRows({ touches, contactNames, counts: nameCounts, timeZone: params.timeZone, names });
  const groups = groupUnlinked({ touches, rows, facts });
  const page = Math.min(params.page, Math.max(1, Math.ceil(groups.length / UNLINKED_GROUPS_PER_PAGE)));
  const from = (page - 1) * UNLINKED_GROUPS_PER_PAGE;

  return {
    groups: groups.slice(from, from + UNLINKED_GROUPS_PER_PAGE),
    rules: [],
    total: groups.length,
    touches: touches.length,
    truncated: touches.length >= UNLINKED_MAX_TOUCHES,
    counts,
    page,
    pageSize: UNLINKED_GROUPS_PER_PAGE,
  };
}

async function loadContactNames(supabase: Db, contactIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const ids of chunks(contactIds, IDS_PER_QUERY)) {
    const { data } = await supabase.from("contacts").select("id, display_name").in("id", ids);
    for (const c of (data ?? []) as Array<{ id: string; display_name: string | null }>) if (c.display_name) out[c.id] = c.display_name;
  }
  return out;
}

/** Agenda, venta y primer/ultimo toque de cada contacto. Un error deja el dato en «no»: nunca tumba la pantalla. */
async function loadContactFacts(supabase: Db, workspaceId: string, contactIds: string[]): Promise<Record<string, ContactFacts>> {
  const facts: Record<string, ContactFacts> = {};
  for (const id of contactIds) facts[id] = { hasBooking: false, hasSale: false, firstTouchId: null, lastTouchId: null };

  for (const ids of chunks(contactIds, IDS_PER_QUERY)) {
    const [touchesRes, bookingsRes] = await Promise.all([
      supabase.from("contact_touches").select("id, contact_id, occurred_at, created_at").eq("workspace_id", workspaceId).in("contact_id", ids),
      supabase.from("bookings").select("contact_id").eq("workspace_id", workspaceId).in("contact_id", ids),
    ]);
    const firstLast = firstAndLastTouch((touchesRes.data ?? []) as Array<{ id: string; contact_id: string; occurred_at: string; created_at: string }>);
    for (const [contactId, fl] of Object.entries(firstLast)) {
      if (facts[contactId]) Object.assign(facts[contactId], fl);
    }
    for (const b of (bookingsRes.data ?? []) as Array<{ contact_id: string | null }>) if (b.contact_id && facts[b.contact_id]) facts[b.contact_id].hasBooking = true;
    // @plantilla-desde(ventas)
    const { data: sales } = await supabase.from("sales").select("contact_id").eq("workspace_id", workspaceId).in("contact_id", ids);
    for (const s of (sales ?? []) as Array<{ contact_id: string | null }>) if (s.contact_id && facts[s.contact_id]) facts[s.contact_id].hasSale = true;
    // @plantilla-hasta(ventas)
  }
  return facts;
}

/** Cuantos anuncios o campañas comparten el nombre, para los toques de nombre ambiguo. */
async function loadNameCounts(supabase: Db, workspaceId: string, touches: UnlinkedTouch[]): Promise<NameCounts> {
  const counts: NameCounts = { ads: {}, campaigns: {} };
  const keys = ambiguousKeys(touches);
  if (keys.ads.length > 0) {
    const { data } = await supabase.from("meta_ads").select("name_key").eq("workspace_id", workspaceId).in("name_key", keys.ads);
    for (const r of (data ?? []) as Array<{ name_key: string | null }>) if (r.name_key) counts.ads[r.name_key] = (counts.ads[r.name_key] ?? 0) + 1;
  }
  if (keys.campaigns.length > 0) {
    const { data } = await supabase.from("meta_campaigns").select("name_key").eq("workspace_id", workspaceId).in("name_key", keys.campaigns);
    for (const r of (data ?? []) as Array<{ name_key: string | null }>) if (r.name_key) counts.campaigns[r.name_key] = (counts.campaigns[r.name_key] ?? 0) + 1;
  }
  return counts;
}

/** Las reglas, con los nombres de su destino y cuantos toques las usan hoy. */
async function loadRules(supabase: Db, workspaceId: string, timeZone?: string): Promise<RuleRow[]> {
  const { data, error } = await supabase
    .from("meta_match_rules")
    .select("id, campaign_key, content_key, term_key, utm_campaign, utm_content, utm_term, action, ad_id, adset_id, campaign_id, origin, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) console.error("[sin-vincular] no pude leer las reglas:", error.message);
  const rules = (data ?? []) as MetaRuleRecord[];
  if (rules.length === 0) return [];

  const { data: used } = await supabase
    .from("contact_touches")
    .select("campaign, content_label, term")
    .eq("workspace_id", workspaceId)
    .eq("meta_match_method", "rule")
    .limit(UNLINKED_MAX_TOUCHES);
  const usage: Record<string, number> = {};
  for (const t of (used ?? []) as Array<{ campaign: string | null; content_label: string | null; term: string | null }>) {
    const key = ruleKeyOf(t.campaign, t.content_label, t.term);
    usage[key] = (usage[key] ?? 0) + 1;
  }

  const names = await loadMetaNamesByIds(
    supabase as unknown as SupabaseClient,
    workspaceId,
    rules.map((r) => ({ campaign: r.campaign_id, adset: r.adset_id, ad: r.ad_id })),
  );
  return buildRuleRows({ rules, names, usage, timeZone });
}
