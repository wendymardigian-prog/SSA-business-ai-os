/**
 * Lo que arma el dashboard de anuncios para dibujar (réplica del panel de
 * wendymardigian).
 *
 * Todo puro y probado: la pantalla solo pinta lo que sale de acá. Dos reglas
 * que valen para todo el archivo, las mismas de `ads.ts`:
 *
 * - **Una division por cero es null, no cero.** Un dia sin clics no tiene
 *   CPC: en el grafico es un hueco, en la tabla una raya.
 * - **Lo que se calcula, se calcula sobre totales**, nunca promediando
 *   porcentajes ya hechos.
 */

import type { BreakdownRow } from "@/lib/meta/live";
import { computeTotals, groupByObject, ratio, type AdsRow, type AdsTotals, type GroupedRow } from "./ads";

// ── Colores de los graficos (copiados de la referencia) ───────────────────

/** Para series multiples: un color por anuncio o por campaña. */
export const AD_COLORS = [
  "#7c3aed", // purple-600
  "#ec4899", // pink-500
  "#0891b2", // cyan-600
  "#f59e0b", // amber-500
  "#10b981", // emerald-500
  "#6366f1", // indigo-500
  "#ef4444", // red-500
  "#a78bfa", // purple-400
  "#14b8a6", // teal-500
  "#f472b6", // pink-400
];

/**
 * Un color estable por objeto: ordenados por nombre, asi el mismo anuncio
 * tiene el mismo color en la comparativa y en el costo, y no cambia porque
 * otro gasto mas.
 */
export function colorMap(items: Array<{ id: string; name: string | null }>): Record<string, string> {
  const sorted = [...items].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
  const out: Record<string, string> = {};
  sorted.forEach((item, i) => {
    out[item.id] = AD_COLORS[i % AD_COLORS.length];
  });
  return out;
}

// ── Variacion de los KPIs ────────────────────────────────────────────────

export interface KpiDelta {
  /** Cambio porcentual contra el periodo anterior, con un decimal. */
  percent: number;
  /** Si el cambio es bueno o malo: en un costo, subir es malo. */
  tone: "good" | "bad" | "neutral";
}

/**
 * La variacion contra el periodo anterior.
 *
 * Sin dato de alguno de los dos periodos, o con el anterior en cero, no hay
 * variacion que mostrar: un "+∞%" no dice nada.
 */
export function kpiDelta(
  now: number | null,
  previous: number | null,
  options: { invert?: boolean } = {},
): KpiDelta | null {
  if (now === null || previous === null || previous === 0) return null;
  const percent = Number((((now - previous) / previous) * 100).toFixed(1));
  if (percent === 0) return { percent, tone: "neutral" };
  const up = percent > 0;
  return { percent, tone: up !== Boolean(options.invert) ? "good" : "bad" };
}

/** Cuando escribio el sync por ultima vez alguna fila del periodo. */
export function lastSyncedAt(rows: AdsRow[]): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (row.updatedAt && (latest === null || row.updatedAt > latest)) latest = row.updatedAt;
  }
  return latest;
}

// ── Acciones generadas ───────────────────────────────────────────────────

export const ACTION_LABELS: Record<string, string> = {
  link_click: "Clics en enlace",
  lead: "Leads",
  video_view: "Reproducciones",
  post_engagement: "Engagement",
  post_reaction: "Reacciones",
  comment: "Comentarios",
  post: "Compartidos",
  omni_purchase: "Compras",
  omni_add_to_cart: "Add to cart",
  complete_registration: "Registros",
};

/** Las que se muestran en la tarjeta, como en la referencia. */
export const SHOWN_ACTIONS = ["link_click", "lead", "video_view", "post_engagement", "post_reaction", "comment", "post"];

export interface ActionItem {
  type: string;
  label: string;
  value: number;
}

/** Las acciones del periodo, sumadas, de mayor a menor. */
export function aggregateActions(rows: AdsRow[]): ActionItem[] {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    for (const [type, value] of Object.entries(row.actions ?? {})) {
      totals[type] = (totals[type] ?? 0) + value;
    }
  }
  return SHOWN_ACTIONS.filter((type) => (totals[type] ?? 0) > 0)
    .map((type) => ({ type, label: ACTION_LABELS[type] ?? type, value: totals[type] }))
    .sort((a, b) => b.value - a.value);
}

// ── Comparativas ─────────────────────────────────────────────────────────

export type CompareMetric = "spend" | "reach" | "clicks" | "leads";

export interface Series {
  /** La clave del dato: el id del objeto, para que dos nombres iguales no se pisen. */
  key: string;
  name: string;
  color: string;
}

/**
 * La comparativa por campaña: una barra por campaña, un tramo por anuncio.
 *
 * Los tramos se identifican por el id del anuncio y no por su nombre: dos
 * anuncios que se llaman igual en campañas distintas no pueden sumarse.
 */
export function campaignStack(params: {
  rows: AdsRow[];
  metric: CompareMetric;
  /** Alcance unico por anuncio, de la consulta en vivo. */
  adReach?: Record<string, number> | null;
}): { data: Array<Record<string, string | number | null>>; series: Series[] } {
  const ads = groupByObject(params.rows, "ad", params.adReach);
  const campaigns = groupByObject(params.rows, "campaign");
  const campaignName = new Map(campaigns.map((c) => [c.objectId, c.objectName]));

  const byCampaign = new Map<string, GroupedRow[]>();
  for (const ad of ads) {
    const id = ad.campaignId ?? "?";
    const list = byCampaign.get(id) ?? [];
    list.push(ad);
    byCampaign.set(id, list);
  }

  const colors = colorMap(ads.map((a) => ({ id: a.objectId, name: a.objectName })));
  const data = [...byCampaign.entries()].map(([campaignId, list]) => {
    const entry: Record<string, string | number | null> = {
      campaign: (campaignName.get(campaignId) ?? campaignId).slice(0, 24),
    };
    for (const ad of list) entry[ad.objectId] = ad[params.metric];
    return entry;
  });

  return {
    data,
    series: ads.map((ad) => ({ key: ad.objectId, name: ad.objectName ?? ad.objectId, color: colors[ad.objectId] })),
  };
}

/** La comparativa por anuncio (detalle): una barra por anuncio, de mayor a menor. */
export function adComparison(params: {
  ads: GroupedRow[];
  metric: CompareMetric;
}): Array<{ id: string; name: string; value: number; color: string }> {
  const colors = colorMap(params.ads.map((a) => ({ id: a.objectId, name: a.objectName })));
  return params.ads
    .map((ad) => ({ id: ad.objectId, name: ad.objectName ?? ad.objectId, value: ad[params.metric], color: colors[ad.objectId] }))
    .filter((item): item is { id: string; name: string; value: number; color: string } => item.value !== null && item.value > 0)
    .sort((a, b) => b.value - a.value);
}

/**
 * El costo diario (CPC o CPL) de cada objeto de un nivel.
 *
 * Un dia sin clics (o sin leads) no tiene costo: queda en null y la linea
 * se corta ahi. Unirla por arriba seria inventar un costo que no existio.
 * Solo entran los objetos que gastaron algo en el periodo.
 */
export function costLines(params: {
  rows: AdsRow[];
  level: "campaign" | "adset" | "ad";
  metric: "cpc" | "cpl";
}): { data: Array<Record<string, string | number | null>>; series: Series[] } {
  const own = params.rows.filter((r) => r.level === params.level);
  const everyObject = groupByObject(own, params.level);
  // El color sale de TODOS los objetos, no solo de los que gastaron: asi es
  // el mismo que el de la comparativa de al lado.
  const colors = colorMap(everyObject.map((o) => ({ id: o.objectId, name: o.objectName })));
  const objects = everyObject.filter((o) => (o.spend ?? 0) > 0);
  const dates = [...new Set(own.map((r) => r.date))].sort();

  const byKey = new Map<string, AdsRow[]>();
  for (const row of own) {
    const key = `${row.objectId}|${row.date}`;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const data = dates.map((date) => {
    const entry: Record<string, string | number | null> = { date: date.slice(5) };
    for (const object of objects) {
      const group = byKey.get(`${object.objectId}|${date}`);
      const totals = group ? computeTotals(group) : null;
      entry[object.objectId] = totals ? totals[params.metric] : null;
    }
    return entry;
  });

  return {
    data,
    series: objects.map((o) => ({ key: o.objectId, name: o.objectName ?? o.objectId, color: colors[o.objectId] })),
  };
}

/** Si una serie de costos tiene al menos un punto: si no, la tarjeta muestra el vacio. */
export function hasAnyPoint(data: Array<Record<string, string | number | null>>, series: Series[]): boolean {
  return data.some((entry) => series.some((s) => typeof entry[s.key] === "number"));
}

// ── Desgloses en vivo ────────────────────────────────────────────────────

/** El CTR de una fila de desglose, con nuestra formula y no la de Meta: 0 impresiones es null. */
function breakdownCtr(row: BreakdownRow): number | null {
  const value = ratio(row.clicks, row.impressions);
  return value === null ? null : Number((value * 100).toFixed(2));
}

export interface PlacementItem {
  name: string;
  spend: number | null;
  impressions: number | null;
  ctr: number | null;
  /** El valor del toggle (gasto o CTR). */
  value: number | null;
  /** Largo de la barrita, sobre el total del toggle. */
  share: number;
}

/** Los placements: los cinco primeros segun el toggle, y el mejor y el peor CTR. */
export function placementSummary(
  rows: BreakdownRow[],
  toggle: "spend" | "ctr",
): { items: PlacementItem[]; best: PlacementItem | null; worst: PlacementItem | null } {
  const all = rows.map((row) => {
    const ctr = breakdownCtr(row);
    const name = `${row.platform ?? "?"} · ${row.position ?? "?"}`.replace(/_/g, " ");
    return { name, spend: row.spend, impressions: row.impressions, ctr, value: toggle === "spend" ? row.spend : ctr, share: 0 };
  });

  const total = all.reduce((acc, item) => acc + (item.value ?? 0), 0);
  for (const item of all) item.share = total > 0 ? ((item.value ?? 0) / total) * 100 : 0;

  const items = [...all].sort((a, b) => (b.value ?? -1) - (a.value ?? -1)).slice(0, 5);
  const withCtr = all.filter((p) => p.ctr !== null && (p.impressions ?? 0) > 0);
  const best = [...withCtr].sort((a, b) => (b.ctr as number) - (a.ctr as number))[0] ?? null;
  const worstCandidate = [...withCtr].sort((a, b) => (a.ctr as number) - (b.ctr as number))[0] ?? null;
  const worst = worstCandidate && best && worstCandidate.name !== best.name ? worstCandidate : null;

  return { items, best, worst };
}

export const DEVICE_LABELS: Record<string, string> = {
  mobile_app: "📱 Mobile (App)",
  mobile_web: "📱 Mobile (Web)",
  desktop: "🖥 Desktop",
  iphone: "📱 Mobile (iOS)",
  android_smartphone: "📱 Mobile (Android)",
};

export interface DeviceItem {
  name: string;
  spend: number | null;
  /** Que parte del gasto total. Null si no hubo gasto. */
  share: number | null;
  ctr: number | null;
}

/** Los dispositivos, con su parte del gasto y su CTR. */
export function deviceSummary(rows: BreakdownRow[]): DeviceItem[] {
  const total = rows.reduce((acc, row) => acc + (row.spend ?? 0), 0);
  return rows.map((row) => ({
    name: DEVICE_LABELS[row.device ?? ""] ?? row.device ?? "?",
    spend: row.spend,
    share: total > 0 ? ((row.spend ?? 0) / total) * 100 : null,
    ctr: breakdownCtr(row),
  }));
}

// ── Audiencia ────────────────────────────────────────────────────────────

export const AGE_ORDER = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
export const GENDERS = ["male", "female", "unknown"] as const;
export type Gender = (typeof GENDERS)[number];

export const GENDER_LABEL: Record<Gender, string> = {
  male: "Hombre",
  female: "Mujer",
  unknown: "Otro",
};

export const GENDER_COLOR: Record<Gender, string> = {
  male: "#6d28d9",
  female: "#ec4899",
  unknown: "#94a3b8",
};

export interface AudienceRow {
  age: string;
  gender: Gender;
  reach: number | null;
  impressions: number | null;
  clicks: number | null;
  leads: number | null;
  ctr: number | null;
}

export function parseAudience(rows: BreakdownRow[]): AudienceRow[] {
  return rows.map((row) => ({
    age: row.age ?? "?",
    gender: row.gender === "male" || row.gender === "female" ? row.gender : "unknown",
    reach: row.reach,
    impressions: row.impressions,
    clicks: row.clicks,
    leads: row.leads,
    ctr: breakdownCtr(row),
  }));
}

/** Barras apiladas por edad: una columna por franja, un tramo por genero. */
export function audienceStack(
  data: AudienceRow[],
  metric: "reach" | "leads",
): { rows: Array<Record<string, string | number | null>>; genders: Gender[] } {
  const rows = AGE_ORDER.flatMap((age) => {
    const ofAge = data.filter((r) => r.age === age);
    if (ofAge.length === 0) return [];
    const entry: Record<string, string | number | null> = { age };
    for (const row of ofAge) entry[row.gender] = row[metric];
    return [entry];
  });
  const genders = GENDERS.filter((g) => rows.some((r) => typeof r[g] === "number" && (r[g] as number) > 0));
  return { rows, genders };
}

/** El total por genero (alcance), para la dona. */
export function genderTotals(data: AudienceRow[]): Array<{ gender: Gender; name: string; value: number; color: string; share: number }> {
  const totals = GENDERS.map((gender) => ({
    gender,
    name: GENDER_LABEL[gender],
    value: data.filter((r) => r.gender === gender).reduce((acc, r) => acc + (r.reach ?? 0), 0),
    color: GENDER_COLOR[gender],
  })).filter((g) => g.value > 0);
  const total = totals.reduce((acc, g) => acc + g.value, 0);
  return totals.map((g) => ({ ...g, share: total > 0 ? Math.round((g.value / total) * 100) : 0 }));
}

/** El CTR por franja de edad, una linea por genero. Una franja sin CTR queda afuera. */
export function ctrByAge(data: AudienceRow[]): { rows: Array<Record<string, string | number | null>>; genders: Gender[] } {
  const genders = GENDERS.filter((g) => data.some((r) => r.gender === g && r.ctr !== null && r.ctr > 0));
  const rows = AGE_ORDER.flatMap((age) => {
    const entry: Record<string, string | number | null> = { age };
    let has = false;
    for (const g of genders) {
      const row = data.find((r) => r.age === age && r.gender === g);
      if (row && row.ctr !== null) {
        entry[g] = row.ctr;
        has = true;
      }
    }
    return has ? [entry] : [];
  });
  return { rows, genders };
}

// ── Horario ──────────────────────────────────────────────────────────────

export interface HourPoint {
  hour: number;
  label: string;
  spend: number | null;
  clicks: number | null;
  ctr: number | null;
}

/** Las 24 horas. Una hora sin entrega queda en null: no hay barra, no un cero. */
export function hourlySeries(rows: BreakdownRow[]): HourPoint[] {
  const byHour = new Map<number, BreakdownRow>();
  for (const row of rows) if (row.hour !== null) byHour.set(row.hour, row);
  return Array.from({ length: 24 }, (_, hour) => {
    const row = byHour.get(hour);
    return {
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      spend: row?.spend ?? null,
      clicks: row?.clicks ?? null,
      ctr: row ? breakdownCtr(row) : null,
    };
  });
}

// ── Rankings ─────────────────────────────────────────────────────────────

export type RankingTone = "above" | "average" | "below";

/**
 * Como se lee un ranking de Meta. `BELOW_AVERAGE_35`, `_20` y `_10` son
 * todos "inferior": la referencia solo reconocia `BELOW_AVERAGE` a secas.
 */
export function rankingTone(value: string | null): RankingTone | null {
  if (!value || value === "UNKNOWN") return null;
  if (value === "ABOVE_AVERAGE") return "above";
  if (value === "AVERAGE") return "average";
  if (value.startsWith("BELOW_AVERAGE")) return "below";
  return null;
}

export interface Rankings {
  quality: string | null;
  engagement: string | null;
  conversion: string | null;
}

/** El ultimo ranking que dio Meta para cada anuncio, de cada tipo por separado. */
export function latestRankings(rows: AdsRow[]): Record<string, Rankings> {
  const sorted = rows.filter((r) => r.level === "ad").sort((a, b) => b.date.localeCompare(a.date));
  const out: Record<string, Rankings> = {};
  for (const row of sorted) {
    const current = out[row.objectId] ?? { quality: null, engagement: null, conversion: null };
    current.quality ??= row.qualityRanking;
    current.engagement ??= row.engagementRanking;
    current.conversion ??= row.conversionRanking;
    out[row.objectId] = current;
  }
  return out;
}

// ── Metricas por dia ─────────────────────────────────────────────────────

export interface DailyRow {
  date: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  clicks: number | null;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  leads: number | null;
}

/** Una fila por dia, con las cuentas del dia hechas sobre sus totales. */
export function dailyTableRows(rows: AdsRow[]): DailyRow[] {
  const byDate = new Map<string, AdsRow[]>();
  for (const row of rows) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }
  return [...byDate.entries()].map(([date, group]) => {
    const t = computeTotals(group);
    return {
      date,
      spend: t.spend,
      impressions: t.impressions,
      reach: t.reach,
      frequency: t.frequency,
      clicks: t.clicks,
      ctr: t.ctr,
      cpm: t.cpm,
      cpc: t.cpc,
      leads: t.leads,
    };
  });
}

export type SortDir = "asc" | "desc";

/** Ordena por cualquier columna. Lo que no tiene valor va siempre al final. */
export function sortRows<T extends object>(rows: T[], key: keyof T, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const av = a[key] as unknown;
    const bv = b[key] as unknown;
    if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
    if (bv === null || bv === undefined) return -1;
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return dir === "asc" ? cmp : -cmp;
  });
}

// ── Embudo ───────────────────────────────────────────────────────────────

export interface FunnelVizStep {
  label: string;
  value: number | null;
  /** Que porcentaje del paso anterior (el primero, 100). */
  percent: number | null;
}

/**
 * Los pasos del embudo como los dibuja la referencia: impresiones, clics,
 * leads y, si hubo, compras. Sin leads ni compras no hay embudo (null).
 */
export function funnelSteps(totals: AdsTotals): FunnelVizStep[] | null {
  const leads = totals.leads ?? 0;
  const purchases = totals.purchases ?? 0;
  if (leads === 0 && purchases === 0) return null;

  const clicks = totals.outboundClicks ?? totals.clicks;
  const pct = (value: number | null, base: number | null) => {
    const r = ratio(value, base);
    return r === null ? null : Number((r * 100).toFixed(1));
  };

  const steps: FunnelVizStep[] = [
    { label: "Impresiones", value: totals.impressions, percent: 100 },
    { label: "Clics", value: clicks, percent: pct(clicks, totals.impressions) },
    { label: "Leads", value: totals.leads, percent: pct(totals.leads, clicks) },
  ];
  if (purchases > 0) {
    steps.push({
      label: "Compras",
      value: totals.purchases,
      percent: leads > 0 ? pct(totals.purchases, totals.leads) : pct(totals.purchases, clicks),
    });
  }
  return steps;
}
