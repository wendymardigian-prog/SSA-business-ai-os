/**
 * Las cuentas del dashboard de Meta Ads (F56).
 *
 * Las formulas son las de un sistema anterior, y estan aca por una razon: **cada una se
 * calcula sobre los totales del periodo, no promediando los diarios**. El
 * CPC del mes no es el promedio de los CPC diarios; es el gasto del mes
 * dividido por los clics del mes. Un dia con dos clics y mucho gasto
 * arrastraria el promedio a cualquier lado.
 *
 * La otra regla: **una division por cero no es cero**. Sin clics no hay
 * CPC: hay una raya. Un "CPC: $0" se lee como "los clics salen gratis".
 */

export interface AdsRow {
  level: string;
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
  leads: number | null;
  purchases: number | null;
  purchaseValue: number | null;
  status: string | null;
  effectiveStatus: string | null;
  qualityRanking: string | null;
  engagementRanking: string | null;
  conversionRanking: string | null;
  videoP25: number | null;
  videoP50: number | null;
  videoP75: number | null;
  videoP95: number | null;
  videoP100: number | null;
  thruplays: number | null;
  /** Segundos promedio de reproduccion de ese dia. */
  videoAvgTimeSeconds: number | null;
  /** Las acciones crudas de Meta, `{ tipo: cantidad }`. */
  actions: Record<string, number>;
  /** Cuando la escribio el sync por ultima vez. */
  updatedAt: string | null;
}

export interface AdsTotals {
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  outboundClicks: number | null;
  leads: number | null;
  purchases: number | null;
  purchaseValue: number | null;
  frequency: number | null;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  cpl: number | null;
  roas: number | null;
}

function sum(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
}

/** Una division que devuelve null en vez de cero o infinito. */
export function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

/**
 * Los totales del periodo.
 *
 * `uniqueReach` viene de la consulta en vivo (F58) y pisa la suma diaria:
 * sumar alcances cuenta a la misma persona una vez por dia.
 */
export function computeTotals(rows: AdsRow[], uniqueReach?: number | null): AdsTotals {
  const spend = sum(rows.map((r) => r.spend));
  const impressions = sum(rows.map((r) => r.impressions));
  const clicks = sum(rows.map((r) => r.clicks));
  const leads = sum(rows.map((r) => r.leads));
  const purchases = sum(rows.map((r) => r.purchases));
  const purchaseValue = sum(rows.map((r) => r.purchaseValue));
  const reach = uniqueReach ?? sum(rows.map((r) => r.reach));

  const round = (value: number | null, decimals = 2) =>
    value === null ? null : Number(value.toFixed(decimals));

  return {
    spend: round(spend),
    impressions,
    reach,
    clicks,
    outboundClicks: sum(rows.map((r) => r.outboundClicks)),
    leads,
    purchases,
    purchaseValue: round(purchaseValue),
    frequency: round(ratio(impressions, reach)),
    ctr: round(ratio(clicks, impressions) === null ? null : (ratio(clicks, impressions) as number) * 100),
    cpm: round(ratio(spend, impressions) === null ? null : (ratio(spend, impressions) as number) * 1000),
    cpc: round(ratio(spend, clicks)),
    // Sin leads no hay costo por lead: es una raya, no un cero.
    cpl: round(ratio(spend, leads)),
    roas: round(ratio(purchaseValue, spend)),
  };
}

// ── Umbrales de color ────────────────────────────────────────────────────

/** Arriba de esto, el CTR se pinta de verde. */
export const CTR_GOOD = 3.5;

/** Debajo de esto, de rojo. */
export const CTR_BAD = 2;

export type Tone = "good" | "bad" | "neutral";

export function ctrTone(ctr: number | null): Tone {
  if (ctr === null) return "neutral";
  if (ctr > CTR_GOOD) return "good";
  if (ctr < CTR_BAD) return "bad";
  return "neutral";
}

/** Cero leads se marca: es la cifra que dice si la campaña sirve. */
export function leadsTone(leads: number | null): Tone {
  return leads === 0 ? "bad" : "neutral";
}

// ── Formato ──────────────────────────────────────────────────────────────

/** Un monto en la moneda de la cuenta. */
export function money(
  value: number | null,
  currency: string | null,
  options: {
    /**
     * Simbolo corto ("$ 1.234,56", "€ 1.234,56") en vez del codigo
     * ("US$ 1.234,56"). Lo usa el dashboard de anuncios, donde toda la
     * pantalla es de una sola cuenta y la moneda completa esta en el popover.
     */
    narrow?: boolean;
  } = {},
): string {
  if (value === null) return "—";
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: currency || "USD",
      currencyDisplay: options.narrow ? "narrowSymbol" : "symbol",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // Una moneda que Intl no conoce no puede romper la pantalla.
    return `${value.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

export function percent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

export function count(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("es-AR");
}

// ── Agrupaciones ─────────────────────────────────────────────────────────

export interface GroupedRow extends AdsTotals {
  objectId: string;
  objectName: string | null;
  parentName: string | null;
  campaignId: string | null;
  adsetId: string | null;
  status: string | null;
}

/**
 * Las filas de un nivel, sumadas por objeto.
 *
 * `uniqueReach` (de la consulta en vivo, por objeto) pisa la suma de los
 * alcances diarios, con la misma regla que `computeTotals`.
 */
export function groupByObject(
  rows: AdsRow[],
  level: string,
  uniqueReach?: Record<string, number> | null,
): GroupedRow[] {
  const byObject = new Map<string, AdsRow[]>();
  for (const row of rows) {
    if (row.level !== level) continue;
    const list = byObject.get(row.objectId) ?? [];
    list.push(row);
    byObject.set(row.objectId, list);
  }

  return [...byObject.entries()]
    .map(([objectId, group]) => {
      // El nombre y el estado son los de la fila MAS NUEVA: una campaña
      // renombrada tiene que aparecer con su nombre de ahora.
      const latest = [...group].sort((a, b) => b.date.localeCompare(a.date))[0];
      return {
        objectId,
        objectName: latest.objectName,
        parentName: latest.parentName,
        campaignId: latest.campaignId,
        adsetId: latest.adsetId,
        status: latest.effectiveStatus ?? latest.status,
        ...computeTotals(group, uniqueReach?.[objectId] ?? null),
      };
    })
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
}

/** Las metricas de AdsTotals que se pueden graficar por dia. */
export type DailyMetric = keyof AdsTotals;

/** La serie diaria de una metrica. */
export function dailySeries(
  rows: AdsRow[],
  metric: DailyMetric,
): Array<{ bucket: string; value: number | null }> {
  const byDate = new Map<string, AdsRow[]>();
  for (const row of rows) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }

  return [...byDate.entries()]
    .map(([date, group]) => {
      const totals = computeTotals(group);
      return { bucket: date, value: totals[metric] ?? null };
    })
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

// ── Video ────────────────────────────────────────────────────────────────

export interface RetentionPoint {
  label: string;
  /** Que porcentaje de las reproducciones llego hasta ahi. */
  percent: number | null;
}

export interface VideoTotals {
  /** Vistas de 3 segundos (`video_view` en las acciones). */
  videoViews: number | null;
  videoP25: number | null;
  videoP50: number | null;
  videoP75: number | null;
  videoP95: number | null;
  videoP100: number | null;
  /** ThruPlays: 15 segundos o el video entero. */
  thruplays: number | null;
  /** Segundos promedio de reproduccion del periodo. */
  avgTimeSeconds: number | null;
}

/**
 * El video del periodo, sobre las filas de UN objeto.
 *
 * El tiempo promedio no se suma: es el promedio de cada dia pesado por las
 * vistas de ese dia. Un dia con dos vistas no puede pesar lo mismo que uno
 * con dos mil.
 */
export function videoTotals(rows: AdsRow[]): VideoTotals {
  const views = (row: AdsRow) => row.actions?.video_view ?? null;

  let weighted = 0;
  let weight = 0;
  for (const row of rows) {
    const v = views(row);
    if (row.videoAvgTimeSeconds === null || v === null || v === 0) continue;
    weighted += row.videoAvgTimeSeconds * v;
    weight += v;
  }

  return {
    videoViews: sum(rows.map(views)),
    videoP25: sum(rows.map((r) => r.videoP25)),
    videoP50: sum(rows.map((r) => r.videoP50)),
    videoP75: sum(rows.map((r) => r.videoP75)),
    videoP95: sum(rows.map((r) => r.videoP95)),
    videoP100: sum(rows.map((r) => r.videoP100)),
    thruplays: sum(rows.map((r) => r.thruplays)),
    avgTimeSeconds: weight > 0 ? Number((weighted / weight).toFixed(1)) : null,
  };
}

/**
 * La retencion de video.
 *
 * Se calcula sobre las REPRODUCCIONES (las vistas de 3 segundos), no sobre
 * las impresiones: la retencion contesta "de los que empezaron a verlo,
 * cuantos siguieron". Sobre impresiones estaria mezclando eso con cuanta
 * gente decidio verlo. Sin vistas de 3 segundos, la base es el 25%.
 */
export function videoRetention(totals: Omit<VideoTotals, "thruplays" | "avgTimeSeconds">): RetentionPoint[] {
  const base = totals.videoViews ?? totals.videoP25;
  if (base === null || base === 0) return [];

  const at = (value: number | null) =>
    value === null ? null : Number(((value / base) * 100).toFixed(1));

  return [
    { label: "3 seg", percent: at(totals.videoViews) },
    { label: "25%", percent: at(totals.videoP25) },
    { label: "50%", percent: at(totals.videoP50) },
    { label: "75%", percent: at(totals.videoP75) },
    { label: "95%", percent: at(totals.videoP95) },
    { label: "100%", percent: at(totals.videoP100) },
  ];
}

// ── Objetivos ────────────────────────────────────────────────────────────

/** Los objetivos de Meta, en castellano. */
export const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_LEADS: "Clientes potenciales",
  OUTCOME_SALES: "Ventas",
  OUTCOME_TRAFFIC: "Trafico",
  OUTCOME_ENGAGEMENT: "Interaccion",
  OUTCOME_AWARENESS: "Reconocimiento",
  OUTCOME_APP_PROMOTION: "Promocion de la app",
  LEAD_GENERATION: "Clientes potenciales",
  CONVERSIONS: "Conversiones",
  LINK_CLICKS: "Clics en el enlace",
  REACH: "Alcance",
  BRAND_AWARENESS: "Reconocimiento de marca",
  VIDEO_VIEWS: "Reproducciones de video",
  MESSAGES: "Mensajes",
};

export function objectiveLabel(objective: string | null): string {
  if (!objective) return "Sin objetivo";
  return OBJECTIVE_LABELS[objective] ?? objective;
}

/** Los estados, en castellano. */
export const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Activo",
  PAUSED: "Pausado",
  DELETED: "Borrado",
  ARCHIVED: "Archivado",
  CAMPAIGN_PAUSED: "Campaña pausada",
  ADSET_PAUSED: "Conjunto pausado",
  IN_PROCESS: "En revision",
  WITH_ISSUES: "Con problemas",
  PENDING_REVIEW: "En revision",
  DISAPPROVED: "Rechazado",
};

export function statusLabel(status: string | null): string {
  if (!status) return "—";
  return STATUS_LABELS[status] ?? status;
}

// ── Funnel ───────────────────────────────────────────────────────────────

export interface FunnelStep {
  label: string;
  value: number | null;
  /** Que porcentaje del paso anterior. */
  conversion: number | null;
}

/** El embudo: impresiones → clics salientes → leads → compras. */
export function funnel(totals: AdsTotals): FunnelStep[] {
  const steps: Array<{ label: string; value: number | null }> = [
    { label: "Impresiones", value: totals.impressions },
    { label: "Clics salientes", value: totals.outboundClicks ?? totals.clicks },
    { label: "Leads", value: totals.leads },
    { label: "Compras", value: totals.purchases },
  ];

  return steps.map((step, index) => {
    const previous = index > 0 ? steps[index - 1].value : null;
    const conversion = ratio(step.value, previous);
    return {
      ...step,
      conversion: conversion === null ? null : Number((conversion * 100).toFixed(2)),
    };
  });
}
