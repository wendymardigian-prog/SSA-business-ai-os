/**
 * Las métricas de Meta de la tabla «Meta vs CRM» que salen de lo que YA se guarda en `meta_ads_insights_daily`
 * (columnas + el jsonb `actions`), sin llamadas nuevas a Meta (Tirón 2, E2): clics en el enlace, video, conversiones
 * del píxel y calidad.
 *
 * Reglas, las de siempre en este módulo:
 *  - **Se guardan CONTADORES, no cocientes.** El total de la tabla suma los contadores y recién ahí calcula
 *    (hook rate total = Σ reproducciones de 3 s ÷ Σ impresiones), nunca promedia los de cada fila.
 *  - **Un evento que Meta no informa es `null` («—»), nunca 0.** Cero diría «no pasó»; null dice «Meta no lo manda».
 *  - **Un evento = un nombre** (`lib/meta/action-counts.ts`): el mismo evento llega con varios nombres y sumarlos lo duplica.
 *  - Una división por cero es `null`.
 *
 * Módulo puro: lo prueba `ads-meta-metrics.test.ts`.
 */

import type { AdsRow } from "./ads";
import { ratio } from "./ads";
import { countScheduleActions, countSubmitApplicationActions, countViewContentActions } from "@/lib/meta/action-counts";

/** Los contadores de un objeto en el período (o la suma de varios). */
export interface MetaCounters {
  linkClicks: number | null;
  /** Reproducciones de 3 segundos (`video_view` en `actions`). */
  video3s: number | null;
  thruplays: number | null;
  videoP25: number | null;
  videoP50: number | null;
  videoP75: number | null;
  videoP100: number | null;
  /** Para el tiempo promedio visto: Σ (promedio del día × vistas de ese día) y Σ vistas de esos días. */
  watchSeconds: number | null;
  watchWeight: number | null;
  viewContent: number | null;
  applications: number | null;
  bookingsMeta: number | null;
  purchases: number | null;
  purchaseValue: number | null;
  /** Solo nivel anuncio: el valor del último día que lo trajo. */
  qualityRanking: string | null;
  engagementRanking: string | null;
  conversionRanking: string | null;
}

export const EMPTY_COUNTERS: MetaCounters = {
  linkClicks: null,
  video3s: null,
  thruplays: null,
  videoP25: null,
  videoP50: null,
  videoP75: null,
  videoP100: null,
  watchSeconds: null,
  watchWeight: null,
  viewContent: null,
  applications: null,
  bookingsMeta: null,
  purchases: null,
  purchaseValue: null,
  qualityRanking: null,
  engagementRanking: null,
  conversionRanking: null,
};

/** Suma lo que hay; null si nada lo trajo. */
export function sumOrNull(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
}

const round = (value: number | null, decimals = 2): number | null => (value === null ? null : Number(value.toFixed(decimals)));

/** El valor de la fila MÁS NUEVA que lo trae (los rankings cambian día a día: vale el último). */
function latestOf(rows: AdsRow[], pick: (row: AdsRow) => string | null): string | null {
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  for (const row of sorted) {
    const value = pick(row);
    if (value) return value;
  }
  return null;
}

/** Los contadores de las filas de UN objeto. */
export function metaCountersOf(rows: AdsRow[]): MetaCounters {
  let weighted = 0;
  let weight = 0;
  let sawWeight = false;
  for (const row of rows) {
    const views = row.actions?.video_view;
    if (row.videoAvgTimeSeconds === null || row.videoAvgTimeSeconds === undefined || typeof views !== "number" || views <= 0) continue;
    weighted += row.videoAvgTimeSeconds * views;
    weight += views;
    sawWeight = true;
  }

  return {
    linkClicks: sumOrNull(rows.map((r) => r.linkClicks)),
    video3s: sumOrNull(rows.map((r) => (typeof r.actions?.video_view === "number" ? r.actions.video_view : null))),
    thruplays: sumOrNull(rows.map((r) => r.thruplays)),
    videoP25: sumOrNull(rows.map((r) => r.videoP25)),
    videoP50: sumOrNull(rows.map((r) => r.videoP50)),
    videoP75: sumOrNull(rows.map((r) => r.videoP75)),
    videoP100: sumOrNull(rows.map((r) => r.videoP100)),
    watchSeconds: sawWeight ? weighted : null,
    watchWeight: sawWeight ? weight : null,
    viewContent: sumOrNull(rows.map((r) => countViewContentActions(r.actions))),
    applications: sumOrNull(rows.map((r) => countSubmitApplicationActions(r.actions))),
    bookingsMeta: sumOrNull(rows.map((r) => countScheduleActions(r.actions))),
    purchases: sumOrNull(rows.map((r) => r.purchases)),
    purchaseValue: sumOrNull(rows.map((r) => r.purchaseValue)),
    qualityRanking: latestOf(rows, (r) => r.qualityRanking),
    engagementRanking: latestOf(rows, (r) => r.engagementRanking),
    conversionRanking: latestOf(rows, (r) => r.conversionRanking),
  };
}

/** La suma de los contadores de varias filas, para el total. Los rankings no se suman: no hay «ranking total». */
export function sumMetaCounters(list: MetaCounters[]): MetaCounters {
  return {
    linkClicks: sumOrNull(list.map((c) => c.linkClicks)),
    video3s: sumOrNull(list.map((c) => c.video3s)),
    thruplays: sumOrNull(list.map((c) => c.thruplays)),
    videoP25: sumOrNull(list.map((c) => c.videoP25)),
    videoP50: sumOrNull(list.map((c) => c.videoP50)),
    videoP75: sumOrNull(list.map((c) => c.videoP75)),
    videoP100: sumOrNull(list.map((c) => c.videoP100)),
    watchSeconds: sumOrNull(list.map((c) => c.watchSeconds)),
    watchWeight: sumOrNull(list.map((c) => c.watchWeight)),
    viewContent: sumOrNull(list.map((c) => c.viewContent)),
    applications: sumOrNull(list.map((c) => c.applications)),
    bookingsMeta: sumOrNull(list.map((c) => c.bookingsMeta)),
    purchases: sumOrNull(list.map((c) => c.purchases)),
    purchaseValue: sumOrNull(list.map((c) => c.purchaseValue)),
    qualityRanking: null,
    engagementRanking: null,
    conversionRanking: null,
  };
}

/** Los cocientes, SIEMPRE calculados sobre contadores (los de una fila o los sumados del total). */
export interface MetaRatios {
  /** %: clics en el enlace ÷ impresiones. */
  linkCtr: number | null;
  linkCpc: number | null;
  costPerVideo3s: number | null;
  /** %: reproducciones de 3 s ÷ impresiones. */
  hookRate: number | null;
  /** %: ThruPlays ÷ reproducciones de 3 s. */
  holdRate: number | null;
  /** %: cada tramo ÷ reproducciones de 3 s. */
  retention25: number | null;
  retention50: number | null;
  retention75: number | null;
  retention100: number | null;
  /** Segundos. */
  avgWatchSeconds: number | null;
  costPerViewContent: number | null;
  costPerApplication: number | null;
  costPerBookingMeta: number | null;
  costPerPurchase: number | null;
  /** Valor de compras ÷ gasto. */
  roasMeta: number | null;
}

const pct = (n: number | null, d: number | null): number | null => {
  const r = ratio(n, d);
  return r === null ? null : round(r * 100);
};

export function metaRatios(c: MetaCounters, base: { spend: number | null; impressions: number | null }): MetaRatios {
  return {
    linkCtr: pct(c.linkClicks, base.impressions),
    linkCpc: round(ratio(base.spend, c.linkClicks)),
    costPerVideo3s: round(ratio(base.spend, c.video3s)),
    hookRate: pct(c.video3s, base.impressions),
    holdRate: pct(c.thruplays, c.video3s),
    retention25: pct(c.videoP25, c.video3s),
    retention50: pct(c.videoP50, c.video3s),
    retention75: pct(c.videoP75, c.video3s),
    retention100: pct(c.videoP100, c.video3s),
    avgWatchSeconds: c.watchWeight && c.watchWeight > 0 && c.watchSeconds !== null ? round(c.watchSeconds / c.watchWeight, 1) : null,
    costPerViewContent: round(ratio(base.spend, c.viewContent)),
    costPerApplication: round(ratio(base.spend, c.applications)),
    costPerBookingMeta: round(ratio(base.spend, c.bookingsMeta)),
    costPerPurchase: round(ratio(base.spend, c.purchases)),
    roasMeta: round(ratio(c.purchaseValue, base.spend)),
  };
}

/** Los rankings de calidad de Meta, en castellano. */
export const RANKING_LABELS: Record<string, string> = {
  ABOVE_AVERAGE: "Por encima del promedio",
  AVERAGE: "Promedio",
  BELOW_AVERAGE: "Por debajo del promedio",
  BELOW_AVERAGE_10: "Entre el 10 % peor",
  BELOW_AVERAGE_20: "Entre el 20 % peor",
  BELOW_AVERAGE_35: "Entre el 35 % peor",
  UNKNOWN: "Sin datos",
};

export function rankingLabel(value: string | null): string | null {
  if (!value) return null;
  return RANKING_LABELS[value] ?? value;
}
