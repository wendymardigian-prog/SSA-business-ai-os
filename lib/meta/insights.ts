/**
 * Lectura de insights de Meta Ads (F55).
 *
 * Cuatro niveles (cuenta, campaña, conjunto, anuncio) por dia, en la misma
 * tabla. Tres cosas que definen el modulo:
 *
 * 1. **Paginacion completa.** Meta devuelve 25 filas por defecto y una
 *    cuenta con veinte anuncios por treinta dias son seiscientas. Cortar en
 *    la primera pagina da un dashboard que muestra la mitad del gasto sin
 *    avisar, que es peor que no mostrar nada.
 * 2. **Los ultimos 3 dias en cada corrida.** Meta corrige los datos
 *    recientes durante 48 a 72 horas: leer solo ayer deja el numero viejo.
 *    Al activar una cuenta se traen 90 dias de una.
 * 3. **Las acciones se guardan crudas.** Sus nombres cambian por objetivo de
 *    campaña y por plataforma; interpretarlas al escribir congelaria la
 *    interpretacion de hoy en datos de los que no se puede volver.
 */

import { GRAPH, humanizeGraphError, isTransientGraphError, type GraphError } from "./graph";

export type AdsLevel = "account" | "campaign" | "adset" | "ad";

/** Cuantos dias se releen en cada corrida diaria. */
export const RECENT_DAYS = 3;

/** Cuantos dias se traen al activar una cuenta. */
export const BACKFILL_DAYS = 90;

const MAX_PAGES = 50;
const PAGE_SIZE = 500;

/** Los campos que se piden en cada nivel. */
const FIELDS: Record<AdsLevel, string[]> = {
  account: ["spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm", "actions", "action_values", "video_play_actions", "video_p25_watched_actions", "video_p50_watched_actions", "video_p75_watched_actions", "video_p95_watched_actions", "video_p100_watched_actions", "outbound_clicks"],
  campaign: ["campaign_id", "campaign_name", "objective", "spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm", "actions", "action_values", "outbound_clicks"],
  adset: ["adset_id", "adset_name", "campaign_id", "campaign_name", "spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm", "actions", "action_values", "outbound_clicks"],
  ad: ["ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name", "spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm", "actions", "action_values", "outbound_clicks", "quality_ranking", "engagement_rate_ranking", "conversion_rate_ranking", "video_play_actions", "video_p25_watched_actions", "video_p50_watched_actions", "video_p75_watched_actions", "video_p95_watched_actions", "video_p100_watched_actions"],
};

interface ActionEntry {
  action_type?: string;
  value?: string | number;
}

export interface InsightRow {
  level: AdsLevel;
  objectId: string;
  objectName: string | null;
  parentName: string | null;
  campaignId: string | null;
  adsetId: string | null;
  date: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  outboundClicks: number | null;
  linkClicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  leads: number | null;
  purchases: number | null;
  purchaseValue: number | null;
  videoP25: number | null;
  videoP50: number | null;
  videoP75: number | null;
  videoP95: number | null;
  videoP100: number | null;
  thruplays: number | null;
  qualityRanking: string | null;
  engagementRanking: string | null;
  conversionRanking: string | null;
  /** Las acciones crudas de Meta, tal como vinieron. */
  actions: Record<string, number>;
}

const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Suma el valor de una accion. Null si esa accion no vino. */
export function actionValue(actions: ActionEntry[] | undefined, matcher: (type: string) => boolean): number | null {
  if (!actions) return null;
  const matched = actions.filter((a) => a.action_type && matcher(a.action_type));
  if (matched.length === 0) return null;
  return matched.reduce((sum, a) => sum + (number(a.value) ?? 0), 0);
}

/**
 * Cuantos leads.
 *
 * Meta los nombra distinto segun el objetivo y la plataforma: `lead`,
 * `onsite_conversion.lead_grouped`, `offsite_conversion.fb_pixel_lead`,
 * `complete_registration`. Buscar la palabra adentro del tipo es lo que
 * hace que la cifra sea la misma cambie el objetivo de la campaña.
 */
export function countLeads(actions: ActionEntry[] | undefined): number | null {
  return actionValue(actions, (type) => type.includes("lead") || type.includes("complete_registration"));
}

export function countPurchases(actions: ActionEntry[] | undefined): number | null {
  return actionValue(actions, (type) => type.includes("purchase"));
}

/** Todas las acciones, como mapa, para guardarlas crudas. */
export function actionsMap(actions: ActionEntry[] | undefined): Record<string, number> {
  const map: Record<string, number> = {};
  for (const action of actions ?? []) {
    if (!action.action_type) continue;
    map[action.action_type] = (map[action.action_type] ?? 0) + (number(action.value) ?? 0);
  }
  return map;
}

interface RawInsight {
  date_start?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: ActionEntry[];
  action_values?: ActionEntry[];
  outbound_clicks?: ActionEntry[];
  quality_ranking?: string;
  engagement_rate_ranking?: string;
  conversion_rate_ranking?: string;
  video_play_actions?: ActionEntry[];
  video_p25_watched_actions?: ActionEntry[];
  video_p50_watched_actions?: ActionEntry[];
  video_p75_watched_actions?: ActionEntry[];
  video_p95_watched_actions?: ActionEntry[];
  video_p100_watched_actions?: ActionEntry[];
}

/** Que objeto es cada fila, segun el nivel. */
export function objectOf(raw: RawInsight, level: AdsLevel, adAccountId: string): {
  objectId: string;
  objectName: string | null;
  parentName: string | null;
} {
  switch (level) {
    case "campaign":
      return { objectId: raw.campaign_id ?? "", objectName: raw.campaign_name ?? null, parentName: null };
    case "adset":
      return {
        objectId: raw.adset_id ?? "",
        objectName: raw.adset_name ?? null,
        parentName: raw.campaign_name ?? null,
      };
    case "ad":
      return {
        objectId: raw.ad_id ?? "",
        objectName: raw.ad_name ?? null,
        parentName: raw.adset_name ?? null,
      };
    default:
      return { objectId: adAccountId, objectName: null, parentName: null };
  }
}

/** Una fila cruda de Meta a la forma de la tabla. */
export function normalizeInsight(
  raw: RawInsight,
  level: AdsLevel,
  adAccountId: string,
): InsightRow | null {
  const { objectId, objectName, parentName } = objectOf(raw, level, adAccountId);
  // Sin objeto ni fecha no hay donde guardarla: el unico de la tabla es
  // (workspace, nivel, objeto, fecha).
  if (!objectId || !raw.date_start) return null;

  const first = (entries: ActionEntry[] | undefined) =>
    entries && entries.length > 0 ? number(entries[0].value) : null;

  return {
    level,
    objectId,
    objectName,
    parentName,
    campaignId: raw.campaign_id ?? null,
    adsetId: raw.adset_id ?? null,
    date: raw.date_start,
    spend: number(raw.spend),
    impressions: number(raw.impressions),
    reach: number(raw.reach),
    clicks: number(raw.clicks),
    outboundClicks: first(raw.outbound_clicks),
    linkClicks: actionValue(raw.actions, (t) => t === "link_click"),
    ctr: number(raw.ctr),
    cpc: number(raw.cpc),
    cpm: number(raw.cpm),
    leads: countLeads(raw.actions),
    purchases: countPurchases(raw.actions),
    purchaseValue: actionValue(raw.action_values, (t) => t.includes("purchase")),
    videoP25: first(raw.video_p25_watched_actions),
    videoP50: first(raw.video_p50_watched_actions),
    videoP75: first(raw.video_p75_watched_actions),
    videoP95: first(raw.video_p95_watched_actions),
    videoP100: first(raw.video_p100_watched_actions),
    thruplays: first(raw.video_play_actions),
    qualityRanking: raw.quality_ranking ?? null,
    engagementRanking: raw.engagement_rate_ranking ?? null,
    conversionRanking: raw.conversion_rate_ranking ?? null,
    actions: actionsMap(raw.actions),
  };
}

export type FetchInsightsResult =
  | { ok: true; rows: InsightRow[]; pages: number }
  | { ok: false; error: string; retryable: boolean };

/**
 * Trae los insights de un nivel, paginando hasta el final.
 *
 * `time_increment=1` es lo que los parte por dia. Sin eso Meta devuelve un
 * total del periodo y no se puede armar ninguna serie.
 */
export async function fetchInsights(params: {
  token: string;
  adAccountId: string;
  level: AdsLevel;
  since: string;
  until: string;
  fetchImpl?: typeof fetch;
}): Promise<FetchInsightsResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const rows: InsightRow[] = [];

  const url = new URL(`${GRAPH}/${params.adAccountId}/insights`);
  url.searchParams.set("level", params.level);
  url.searchParams.set("fields", FIELDS[params.level].join(","));
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({ since: params.since, until: params.until }));
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("access_token", params.token);

  let next: string | null = url.toString();
  let pages = 0;

  while (next && pages < MAX_PAGES) {
    let body: { data?: RawInsight[]; paging?: { next?: string }; error?: GraphError };
    try {
      const response = await fetchImpl(next);
      body = await response.json();
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        // Una caida de red es temporal: la peticion era valida.
        retryable: true,
      };
    }

    if (body.error) {
      return {
        ok: false,
        error: humanizeGraphError(body.error),
        retryable: isTransientGraphError(body.error),
      };
    }

    for (const raw of body.data ?? []) {
      const row = normalizeInsight(raw, params.level, params.adAccountId);
      if (row) rows.push(row);
    }

    pages += 1;
    next = body.paging?.next ?? null;
  }

  return { ok: true, rows, pages };
}

/** El rango de una corrida: los ultimos dias, o 90 al activar la cuenta. */
export function syncRange(params: { now: Date; firstSync: boolean }): { since: string; until: string } {
  const days = params.firstSync ? BACKFILL_DAYS : RECENT_DAYS;
  const until = params.now.toISOString().slice(0, 10);
  const since = new Date(params.now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { since, until };
}

/**
 * Lo que Meta dice de cuanto le queda a nuestra cuota.
 *
 * Viene en una cabecera con JSON adentro. Pasado el 90% conviene parar: el
 * bloqueo de Meta dura una hora y se lleva puesta la corrida entera.
 */
export function readUsage(header: string | null): { percent: number; shouldPause: boolean } | null {
  if (!header) return null;
  try {
    const parsed = JSON.parse(header) as Record<
      string,
      Array<{ call_count?: number; total_cputime?: number; total_time?: number }>
    >;
    const values = Object.values(parsed).flat();
    const percent = Math.max(
      0,
      ...values.flatMap((v) => [v.call_count ?? 0, v.total_cputime ?? 0, v.total_time ?? 0]),
    );
    return { percent, shouldPause: percent >= 90 };
  } catch {
    return null;
  }
}
