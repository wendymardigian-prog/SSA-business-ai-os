/**
 * La tabla «Meta vs CRM» del dashboard de Ads (Extra L, AT4, F31): las cuentas.
 *
 * Junta, por campaña, conjunto o anuncio, lo que dice Meta (gasto, clics, leads...) con lo que dice el
 * CRM (`ads_crm_metrics`: leads, agendas, ventas, revenue y cash) y calcula los cocientes.
 *
 * Reglas que mandan en todo el archivo:
 *  - **Una division por cero es «—» (null), nunca 0.** Un CPL de 0 diria «gratis».
 *  - La plata del CRM viene en CENTAVOS (`ads_crm_metrics`) y se pasa a dolares con `fromCents`
 *    (`lib/sales/money.ts`). Siempre USD.
 *  - Los nombres y el estado son los del CATALOGO (`meta_*`), no los de la fila de metricas mas reciente.
 *  - Un objeto que solo tiene CRM (sin gasto en el periodo) aparece igual, con el gasto en «—».
 *  - La fila de total suma lo sumable y calcula los cocientes SOBRE los totales (no promedia cocientes).
 *
 * Modulo puro: lo prueba `ads-crm.test.ts`.
 */

import { ratio, groupByObject, type AdsRow, type GroupedRow } from "./ads";
import { fromCents } from "@/lib/sales/money";

export type CrmLevel = "campaign" | "adset" | "ad";

/** Lo que devuelve `ads_crm_metrics` por objeto. */
export interface CrmMetrics {
  objectId: string;
  leadsFirst: number;
  leadsTotal: number;
  leadsWithBooking: number;
  bookings: number;
  bookingsAttended: number;
  sales: number;
  revenueCents: number;
  cashCents: number;
}

/** Lo que dice el catalogo de un objeto. */
export interface CatalogEntry {
  name: string | null;
  /** El `effective_status` del catalogo. */
  effectiveStatus: string | null;
  /** Para un conjunto, su campaña; para un anuncio, su conjunto. */
  parentName?: string | null;
  /** La miniatura firmada (solo anuncios). */
  thumbnailUrl?: string | null;
  /** El titulo del creativo (solo anuncios), para el tooltip de la miniatura. */
  creativeTitle?: string | null;
}

export type StatusKind = "active" | "paused" | "other";
export type StatusFilter = "all" | "active" | "paused";

/** Los estados que cuentan como «pausados»: incluye los que se pausan porque se pauso el padre. */
const PAUSED = new Set(["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"]);

export function statusKind(effectiveStatus: string | null | undefined): StatusKind {
  if (effectiveStatus === "ACTIVE") return "active";
  if (effectiveStatus && PAUSED.has(effectiveStatus)) return "paused";
  return "other";
}

export interface CrmRow {
  objectId: string;
  name: string | null;
  effectiveStatus: string | null;
  statusKind: StatusKind;
  parentName: string | null;
  thumbnailUrl: string | null;
  creativeTitle: string | null;
  /** Hubo metricas de Meta (gasto, etc.) en el periodo. */
  hasMeta: boolean;

  // Meta
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  clicks: number | null;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  /** Leads que cuenta Meta. */
  leadsMeta: number | null;
  /** CPL con los leads de Meta. */
  cplMeta: number | null;
  conversions: number | null;
  /** Agendas que cuenta Meta (el evento `schedule`), o null si ese evento no existe. */
  bookingsMeta: number | null;

  // CRM (conteos)
  leadsFirst: number;
  leadsTotal: number;
  leadsWithBooking: number;
  bookings: number;
  attended: number;
  sales: number;
  /** Dolares. */
  revenue: number;
  cash: number;

  // CRM (cocientes)
  /** Contactos con agenda ÷ leads totales, en %. */
  leadToBooking: number | null;
  cplReal: number | null;
  costPerBooking: number | null;
  roas: number | null;
  roasCash: number | null;
  cac: number | null;
  costPerClose: number | null;
}

const round2 = (value: number | null): number | null => (value === null ? null : Number(value.toFixed(2)));

/** Los cocientes del CRM, a partir de los conteos y el gasto. Compartido por las filas y por el total. */
export function crmRatios(input: { spend: number | null; leadsTotal: number; leadsWithBooking: number; bookings: number; sales: number; revenue: number; cash: number }) {
  const pct = ratio(input.leadsWithBooking, input.leadsTotal);
  return {
    leadToBooking: round2(pct === null ? null : pct * 100),
    cplReal: round2(ratio(input.spend, input.leadsTotal)),
    costPerBooking: round2(ratio(input.spend, input.bookings)),
    // Con gasto 0 o sin gasto, el ROAS es «—»: dividir por cero no es infinito, es no saberlo.
    roas: round2(ratio(input.revenue, input.spend)),
    roasCash: round2(ratio(input.cash, input.spend)),
    cac: round2(ratio(input.spend, input.sales)),
    costPerClose: round2(ratio(input.spend, input.sales)),
  };
}

/** Las agendas que cuenta Meta: el evento `schedule` de `actions`. Null si ninguna fila trae ese evento. */
export function scheduleCount(rows: AdsRow[]): number | null {
  let found = false;
  let total = 0;
  for (const row of rows) {
    for (const [type, value] of Object.entries(row.actions ?? {})) {
      if (/schedule/i.test(type) && Number.isFinite(value)) {
        found = true;
        total += value;
      }
    }
  }
  return found ? total : null;
}

export interface BuildParams {
  /** Las filas de metricas del periodo (`meta_ads_insights_daily`), de todos los niveles. */
  rows: AdsRow[];
  level: CrmLevel;
  /** Lo que devolvio `ads_crm_metrics` para este nivel. */
  metrics: CrmMetrics[];
  catalog: Record<string, CatalogEntry>;
  /** Alcance unico por objeto (consulta en vivo), si se pudo pedir. */
  uniqueReach?: Record<string, number> | null;
}

/** Las filas de la tabla: la union de los objetos con metricas de Meta y los que tienen algo en el CRM. */
export function buildCrmRows(params: BuildParams): CrmRow[] {
  const groups = new Map<string, GroupedRow>(groupByObject(params.rows, params.level, params.uniqueReach ?? null).map((g) => [g.objectId, g]));
  const crm = new Map(params.metrics.map((m) => [m.objectId, m]));
  const rowsByObject = new Map<string, AdsRow[]>();
  for (const row of params.rows) {
    if (row.level !== params.level) continue;
    const list = rowsByObject.get(row.objectId) ?? [];
    list.push(row);
    rowsByObject.set(row.objectId, list);
  }

  const ids = new Set<string>([...groups.keys(), ...crm.keys()]);

  const out: CrmRow[] = [];
  for (const objectId of ids) {
    const g = groups.get(objectId) ?? null;
    const c = crm.get(objectId) ?? null;
    const cat = params.catalog[objectId] ?? null;

    const effectiveStatus = cat?.effectiveStatus ?? g?.status ?? null;
    const spend = g?.spend ?? null;
    const revenue = fromCents(c?.revenueCents ?? 0);
    const cash = fromCents(c?.cashCents ?? 0);
    const leadsTotal = c?.leadsTotal ?? 0;
    const bookings = c?.bookings ?? 0;
    const sales = c?.sales ?? 0;
    const leadsWithBooking = c?.leadsWithBooking ?? 0;

    out.push({
      objectId,
      name: cat?.name ?? g?.objectName ?? null,
      effectiveStatus,
      statusKind: statusKind(effectiveStatus),
      parentName: cat?.parentName ?? g?.parentName ?? null,
      thumbnailUrl: cat?.thumbnailUrl ?? null,
      creativeTitle: cat?.creativeTitle ?? null,
      hasMeta: g !== null,

      spend,
      impressions: g?.impressions ?? null,
      reach: g?.reach ?? null,
      frequency: g?.frequency ?? null,
      clicks: g?.clicks ?? null,
      ctr: g?.ctr ?? null,
      cpm: g?.cpm ?? null,
      cpc: g?.cpc ?? null,
      leadsMeta: g?.leads ?? null,
      cplMeta: g?.cpl ?? null,
      conversions: g?.purchases ?? null,
      bookingsMeta: scheduleCount(rowsByObject.get(objectId) ?? []),

      leadsFirst: c?.leadsFirst ?? 0,
      leadsTotal,
      leadsWithBooking,
      bookings,
      attended: c?.bookingsAttended ?? 0,
      sales,
      revenue,
      cash,
      ...crmRatios({ spend, leadsTotal, leadsWithBooking, bookings, sales, revenue, cash }),
    });
  }

  return sortCrmRows(out);
}

/** Por gasto (los que no tienen, al final) y despues por leads totales; el nombre desempata para que el orden sea estable. */
export function sortCrmRows(rows: CrmRow[]): CrmRow[] {
  return [...rows].sort((a, b) => {
    const spend = (b.spend ?? -1) - (a.spend ?? -1);
    if (spend !== 0) return spend;
    const leads = b.leadsTotal - a.leadsTotal;
    if (leads !== 0) return leads;
    return (a.name ?? a.objectId).localeCompare(b.name ?? b.objectId);
  });
}

export function filterByStatus(rows: CrmRow[], filter: StatusFilter): CrmRow[] {
  if (filter === "all") return rows;
  return rows.filter((row) => row.statusKind === filter);
}

/** Cuantos hay de cada estado, para los numeros de las pills. */
export function countByStatus(rows: CrmRow[]): Record<StatusFilter, number> {
  return {
    all: rows.length,
    active: rows.filter((r) => r.statusKind === "active").length,
    paused: rows.filter((r) => r.statusKind === "paused").length,
  };
}

const sumOrNull = (values: Array<number | null>): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
};

/**
 * La fila de total: suma lo sumable y calcula los cocientes SOBRE los totales.
 *
 * `reach`/`frequency` no se suman (el alcance es de personas unicas): solo se muestran cuando se pasa el total
 * real de la cuenta (`overallReach`), que es el que corresponde cuando la tabla muestra todos los objetos.
 */
export function totalRow(rows: CrmRow[], overallReach: number | null = null): CrmRow {
  const spend = round2(sumOrNull(rows.map((r) => r.spend)));
  const impressions = sumOrNull(rows.map((r) => r.impressions));
  const clicks = sumOrNull(rows.map((r) => r.clicks));
  const leadsMeta = sumOrNull(rows.map((r) => r.leadsMeta));
  const conversions = sumOrNull(rows.map((r) => r.conversions));
  const leadsTotal = rows.reduce((a, r) => a + r.leadsTotal, 0);
  const leadsWithBooking = rows.reduce((a, r) => a + r.leadsWithBooking, 0);
  const bookings = rows.reduce((a, r) => a + r.bookings, 0);
  const sales = rows.reduce((a, r) => a + r.sales, 0);
  const revenue = round2(rows.reduce((a, r) => a + r.revenue, 0)) ?? 0;
  const cash = round2(rows.reduce((a, r) => a + r.cash, 0)) ?? 0;

  const ctr = ratio(clicks, impressions);
  const cpm = ratio(spend, impressions);

  return {
    objectId: "total",
    name: "Total",
    effectiveStatus: null,
    statusKind: "other",
    parentName: null,
    thumbnailUrl: null,
    creativeTitle: null,
    hasMeta: rows.some((r) => r.hasMeta),

    spend,
    impressions,
    reach: overallReach,
    frequency: round2(ratio(impressions, overallReach)),
    clicks,
    ctr: round2(ctr === null ? null : ctr * 100),
    cpm: round2(cpm === null ? null : cpm * 1000),
    cpc: round2(ratio(spend, clicks)),
    leadsMeta,
    cplMeta: round2(ratio(spend, leadsMeta)),
    conversions,
    bookingsMeta: sumOrNull(rows.map((r) => r.bookingsMeta)),

    leadsFirst: rows.reduce((a, r) => a + r.leadsFirst, 0),
    leadsTotal,
    leadsWithBooking,
    bookings,
    attended: rows.reduce((a, r) => a + r.attended, 0),
    sales,
    revenue,
    cash,
    ...crmRatios({ spend, leadsTotal, leadsWithBooking, bookings, sales, revenue, cash }),
  };
}
