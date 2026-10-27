/**
 * La tabla «Meta vs CRM» del dashboard de Ads (Extra L, AT4, F31; Tirón 2, B y E): las cuentas.
 *
 * Junta, por campaña, conjunto o anuncio, lo que dice Meta (gasto, clics, video, conversiones del píxel...) con lo que
 * dice el CRM (`ads_crm_metrics_v2`: leads nuevos y totales, agendas, ventas, revenue, cash y primer pago) y calcula
 * los cocientes.
 *
 * Reglas que mandan en todo el archivo:
 *  - **Una division por cero es «—» (null), nunca 0.** Un CPL de 0 diria «gratis».
 *  - La plata del CRM viene en CENTAVOS y se pasa a dolares con `fromCents` (`lib/shared/money.ts`). Siempre USD.
 *  - Los nombres y el estado son los del CATALOGO (`meta_*`). Si el catalogo no tiene la fila (todavia no sincronizo),
 *    la tabla usa lo que ya traen los insights (`resolveRowInfo`): nombre, padre, campaña y conjunto.
 *  - Un objeto que solo tiene CRM (sin gasto en el periodo) aparece igual, con el gasto en «—».
 *  - **Leads nuevos vs leads totales** (los dos, siempre, con su CPL):
 *      · Leads NUEVOS: personas cuyo PRIMER toque es ese objeto. Una persona cuenta una sola vez en toda su vida, asi que
 *        el total de esa columna es la suma de las filas, y es exacto.
 *      · Leads TOTALES: personas con algun toque del objeto en el periodo. Una persona que toco dos anuncios cuenta en cada
 *        uno; en la fila de total se cuenta UNA vez (`distinctLeads`, la fila `is_total` de `ads_crm_metrics_v2`).
 *  - La fila de total suma los contadores y calcula los cocientes SOBRE los totales (nunca promedia cocientes).
 *
 * Modulo puro: lo prueba `ads-crm.test.ts`.
 */

import { ratio, groupByObject, type AdsRow, type GroupedRow } from "./ads";
import { fromCents } from "@/lib/shared/money";
import { metaCountersOf, metaRatios, sumMetaCounters, sumOrNull, type MetaCounters, type MetaRatios } from "./ads-meta-metrics";

export type CrmLevel = "campaign" | "adset" | "ad";

/** Lo que devuelve `ads_crm_metrics_v2` por objeto. */
export interface CrmMetrics {
  objectId: string;
  /** Personas cuyo primer toque es del objeto (y que se crearon en el periodo). */
  leadsNew: number;
  /** Personas distintas con algun toque del objeto en el periodo. */
  leadsTotal: number;
  leadsWithBooking: number;
  bookings: number;
  bookingsAttended: number;
  sales: number;
  revenueCents: number;
  cashCents: number;
  /** El primer pago cobrado de cada venta del objeto, en centavos. */
  ufCashCents: number;
}

/** Las personas DISTINTAS de todo el filtro (la fila `is_total` de la funcion): no se pueden sumar de las filas. */
export interface DistinctLeads {
  leadsTotal: number;
  leadsWithBooking: number;
}

/** Lo que dice el catalogo de un objeto. */
export interface CatalogEntry {
  name: string | null;
  /** El `effective_status` del catalogo. */
  effectiveStatus: string | null;
  /** Para un conjunto, su campaña; para un anuncio, su conjunto. */
  parentName?: string | null;
  /** La campaña a la que pertenece (conjuntos y anuncios). */
  campaignName?: string | null;
  /** El conjunto al que pertenece (anuncios). */
  adsetName?: string | null;
  /** El objetivo de la campaña (solo campañas). */
  objective?: string | null;
  /** La miniatura firmada (solo anuncios). */
  thumbnailUrl?: string | null;
  /** El titulo del creativo (solo anuncios), para el tooltip de la miniatura. */
  creativeTitle?: string | null;
  /** El enlace al posteo que promociona (solo anuncios), si se conoce. */
  publicationUrl?: string | null;
}

/** Que anuncio cuelga de que conjunto y campaña: para contar «# anuncios». */
export interface AdLink {
  adId: string;
  adsetId: string | null;
  campaignId: string | null;
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

export interface CrmRow extends MetaRatios, MetaCounters {
  objectId: string;
  name: string | null;
  effectiveStatus: string | null;
  statusKind: StatusKind;
  /** El padre inmediato: el conjunto de un anuncio, la campaña de un conjunto. */
  parentName: string | null;
  campaignName: string | null;
  adsetName: string | null;
  objective: string | null;
  publicationUrl: string | null;
  /** Cuantos anuncios tiene (campañas y conjuntos). */
  adsCount: number | null;
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
  /** Leads que cuenta Meta (un nombre por evento: `lib/meta/action-counts.ts`). */
  leadsMeta: number | null;
  /** CPL con los leads de Meta. */
  cplMeta: number | null;

  // CRM (conteos)
  leadsNew: number;
  leadsTotal: number;
  leadsWithBooking: number;
  bookings: number;
  attended: number;
  sales: number;
  /** Dolares. */
  revenue: number;
  cash: number;
  /** El primer pago cobrado de cada venta, en dolares. */
  ufCash: number;

  // CRM (cocientes)
  /** Contactos con agenda ÷ leads totales, en %. */
  leadToBooking: number | null;
  /** Gasto ÷ leads NUEVOS. */
  cplNew: number | null;
  /** Gasto ÷ leads TOTALES. */
  cplTotal: number | null;
  costPerBooking: number | null;
  costPerAttended: number | null;
  roas: number | null;
  roasCash: number | null;
  ufRoas: number | null;
  /** Gasto ÷ ventas (reemplaza a «CAC» y «Costo por cierre», que eran lo mismo). */
  costPerNewDeal: number | null;
}

const round2 = (value: number | null): number | null => (value === null ? null : Number(value.toFixed(2)));

/** Los cocientes del CRM, a partir de los conteos y el gasto. Compartido por las filas y por el total. */
export function crmRatios(input: {
  spend: number | null;
  leadsNew: number;
  leadsTotal: number;
  leadsWithBooking: number;
  bookings: number;
  attended: number;
  sales: number;
  revenue: number;
  cash: number;
  ufCash: number;
}) {
  const pct = ratio(input.leadsWithBooking, input.leadsTotal);
  return {
    leadToBooking: round2(pct === null ? null : pct * 100),
    cplNew: round2(ratio(input.spend, input.leadsNew)),
    cplTotal: round2(ratio(input.spend, input.leadsTotal)),
    costPerBooking: round2(ratio(input.spend, input.bookings)),
    costPerAttended: round2(ratio(input.spend, input.attended)),
    // Con gasto 0 o sin gasto, el ROAS es «—»: dividir por cero no es infinito, es no saberlo.
    roas: round2(ratio(input.revenue, input.spend)),
    roasCash: round2(ratio(input.cash, input.spend)),
    ufRoas: round2(ratio(input.ufCash, input.spend)),
    costPerNewDeal: round2(ratio(input.spend, input.sales)),
  };
}

/** Las agendas que cuenta Meta: UN nombre del evento `schedule` por dia (`lib/meta/action-counts.ts`). Null si ninguna fila lo trae. */
export function scheduleCount(rows: AdsRow[]): number | null {
  return metaCountersOf(rows).bookingsMeta;
}

// ── De donde sale cada dato de una fila ──────────────────────────────────

export interface RowInfo {
  name: string | null;
  effectiveStatus: string | null;
  parentName: string | null;
  campaignName: string | null;
  adsetName: string | null;
  objective: string | null;
  publicationUrl: string | null;
  adsCount: number | null;
}

/** Los nombres por id de campaña y conjunto que traen los insights (el respaldo cuando el catalogo no tiene la fila). */
export interface NamesById {
  campaign: Map<string, string | null>;
  adset: Map<string, string | null>;
}

/**
 * Los datos descriptivos de una fila: el CATALOGO manda; lo que no tiene, sale de lo que ya traen los insights
 * (`object_name`, `parent_name`, y los nombres de los niveles de arriba por `campaign_id`/`adset_id`). Asi, con el
 * catalogo vacio (todavia no sincronizo), la tabla igual muestra nombre, campaña y conjunto. El ESTADO solo lo da el
 * catalogo (la API de insights no lo trae): sin el queda null y la pantalla dice «Sin estado».
 */
export function resolveRowInfo(args: {
  level: CrmLevel;
  objectId: string;
  catalog: CatalogEntry | null;
  group: GroupedRow | null;
  names: NamesById;
  adLinks: AdLink[];
}): RowInfo {
  const { level, objectId, catalog: cat, group: g, names, adLinks } = args;
  const name = cat?.name ?? g?.objectName ?? null;

  let campaignName: string | null;
  let adsetName: string | null;
  if (level === "campaign") {
    campaignName = name;
    adsetName = null;
  } else if (level === "adset") {
    campaignName = cat?.campaignName ?? cat?.parentName ?? g?.parentName ?? (g?.campaignId ? (names.campaign.get(g.campaignId) ?? null) : null);
    adsetName = name;
  } else {
    campaignName = cat?.campaignName ?? (g?.campaignId ? (names.campaign.get(g.campaignId) ?? null) : null);
    adsetName = cat?.adsetName ?? cat?.parentName ?? g?.parentName ?? (g?.adsetId ? (names.adset.get(g.adsetId) ?? null) : null);
  }

  const adsCount =
    level === "ad" ? null : new Set(adLinks.filter((l) => (level === "campaign" ? l.campaignId === objectId : l.adsetId === objectId)).map((l) => l.adId)).size;

  return {
    name,
    effectiveStatus: cat?.effectiveStatus ?? g?.status ?? null,
    parentName: level === "ad" ? adsetName : level === "adset" ? campaignName : null,
    campaignName,
    adsetName,
    objective: cat?.objective ?? null,
    publicationUrl: cat?.publicationUrl ?? null,
    adsCount,
  };
}

/**
 * El enlace a la publicacion que promociona un anuncio, o null si no se conoce. Primero la de Contenido (la que ya esta vinculada, con
 * su direccion); si no, la de Facebook que arma el id del posteo (`<pagina>_<posteo>`). Instagram sin vinculo no tiene direccion que
 * se pueda armar sin llamar a Meta: queda en «—».
 */
export function publicationUrlOf(args: { socialPostUrl?: string | null; objectStoryId?: string | null }): string | null {
  const own = args.socialPostUrl?.trim();
  if (own && /^https?:\/\//i.test(own)) return own;
  const story = /^(\d+)_(\d+)$/.exec(args.objectStoryId?.trim() ?? "");
  return story ? `https://www.facebook.com/${story[1]}/posts/${story[2]}` : null;
}

export interface BuildParams {
  /** Las filas de metricas del periodo (`meta_ads_insights_daily`), de todos los niveles. */
  rows: AdsRow[];
  level: CrmLevel;
  /** Lo que devolvio `ads_crm_metrics_v2` para este nivel. */
  metrics: CrmMetrics[];
  catalog: Record<string, CatalogEntry>;
  /** Alcance unico por objeto (consulta en vivo), si se pudo pedir. */
  uniqueReach?: Record<string, number> | null;
  /** Que anuncios hay (catalogo e insights), para «# anuncios». Si no se pasa, sale solo de los insights. */
  adLinks?: AdLink[];
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

  // Los nombres de los niveles de arriba, para el respaldo.
  const names: NamesById = { campaign: new Map(), adset: new Map() };
  for (const [level, map] of [["campaign", names.campaign], ["adset", names.adset]] as const) {
    const latest = new Map<string, AdsRow>();
    for (const row of params.rows) {
      if (row.level !== level) continue;
      const before = latest.get(row.objectId);
      if (!before || row.date > before.date) latest.set(row.objectId, row);
    }
    for (const [id, row] of latest) map.set(id, row.objectName);
  }

  // Los anuncios que se conocen: los del catalogo (si vienen) y los que tienen metricas, sin repetir (manda el catalogo).
  const adLinks: AdLink[] = [
    ...new Map(
      [
        ...params.rows.filter((r) => r.level === "ad").map((r): AdLink => ({ adId: r.objectId, adsetId: r.adsetId, campaignId: r.campaignId })),
        ...(params.adLinks ?? []),
      ].map((l) => [l.adId, l] as const),
    ).values(),
  ];

  const ids = new Set<string>([...groups.keys(), ...crm.keys()]);

  const out: CrmRow[] = [];
  for (const objectId of ids) {
    const g = groups.get(objectId) ?? null;
    const c = crm.get(objectId) ?? null;
    const cat = params.catalog[objectId] ?? null;
    const info = resolveRowInfo({ level: params.level, objectId, catalog: cat, group: g, names, adLinks });

    const spend = g?.spend ?? null;
    const impressions = g?.impressions ?? null;
    const revenue = fromCents(c?.revenueCents ?? 0);
    const cash = fromCents(c?.cashCents ?? 0);
    const ufCash = fromCents(c?.ufCashCents ?? 0);
    const leadsNew = c?.leadsNew ?? 0;
    const leadsTotal = c?.leadsTotal ?? 0;
    const bookings = c?.bookings ?? 0;
    const attended = c?.bookingsAttended ?? 0;
    const sales = c?.sales ?? 0;
    const leadsWithBooking = c?.leadsWithBooking ?? 0;

    const counters = metaCountersOf(rowsByObject.get(objectId) ?? []);

    out.push({
      objectId,
      name: info.name,
      effectiveStatus: info.effectiveStatus,
      statusKind: statusKind(info.effectiveStatus),
      parentName: info.parentName,
      campaignName: info.campaignName,
      adsetName: info.adsetName,
      objective: info.objective,
      publicationUrl: info.publicationUrl,
      adsCount: info.adsCount,
      thumbnailUrl: cat?.thumbnailUrl ?? null,
      creativeTitle: cat?.creativeTitle ?? null,
      hasMeta: g !== null,

      spend,
      impressions,
      reach: g?.reach ?? null,
      frequency: g?.frequency ?? null,
      clicks: g?.clicks ?? null,
      ctr: g?.ctr ?? null,
      cpm: g?.cpm ?? null,
      cpc: g?.cpc ?? null,
      leadsMeta: g?.leads ?? null,
      cplMeta: g?.cpl ?? null,
      ...counters,
      ...metaRatios(counters, { spend, impressions }),

      leadsNew,
      leadsTotal,
      leadsWithBooking,
      bookings,
      attended,
      sales,
      revenue,
      cash,
      ufCash,
      ...crmRatios({ spend, leadsNew, leadsTotal, leadsWithBooking, bookings, attended, sales, revenue, cash, ufCash }),
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

export interface TotalOptions {
  /** El alcance unico real de la cuenta: solo cuando la tabla muestra todos los objetos. Sin el, alcance y frecuencia son «—». */
  overallReach?: number | null;
  /**
   * Las personas DISTINTAS del filtro (`ads_crm_metrics_v2`, fila `is_total`). Sin esto, «Leads totales» del total es la suma de
   * las filas (una persona que toco dos anuncios cuenta dos veces) y `leadsTotalIsSum` lo avisa.
   */
  distinctLeads?: DistinctLeads | null;
}

/** La fila de total, mas si sus «Leads totales» son una suma (puede contar dos veces a alguien). */
export interface TotalResult {
  row: CrmRow;
  leadsTotalIsSum: boolean;
}

/**
 * La fila de total: suma los contadores y calcula los cocientes SOBRE los totales.
 *
 * - `reach`/`frequency` no se suman (el alcance es de personas unicas): solo salen con `overallReach`.
 * - **Leads nuevos, agendas, ventas, revenue y cash se SUMAN, y es exacto**: cada persona tiene un solo primer toque y cada
 *   agenda y cada venta cae en un solo objeto por nivel. «Leads totales» NO: una persona con toques de dos anuncios cuenta en
 *   los dos; el total usa `distinctLeads` (personas distintas) y de eso salen el CPL total y «Lead → Agenda» del total.
 */
export function totalRowDetailed(rows: CrmRow[], options: TotalOptions = {}): TotalResult {
  const overallReach = options.overallReach ?? null;
  const spend = round2(sumOrNull(rows.map((r) => r.spend)));
  const impressions = sumOrNull(rows.map((r) => r.impressions));
  const clicks = sumOrNull(rows.map((r) => r.clicks));
  const leadsMeta = sumOrNull(rows.map((r) => r.leadsMeta));

  const leadsNew = rows.reduce((a, r) => a + r.leadsNew, 0);
  const distinct = options.distinctLeads ?? null;
  const leadsTotal = distinct ? distinct.leadsTotal : rows.reduce((a, r) => a + r.leadsTotal, 0);
  const leadsWithBooking = distinct ? distinct.leadsWithBooking : rows.reduce((a, r) => a + r.leadsWithBooking, 0);
  const bookings = rows.reduce((a, r) => a + r.bookings, 0);
  const attended = rows.reduce((a, r) => a + r.attended, 0);
  const sales = rows.reduce((a, r) => a + r.sales, 0);
  const revenue = round2(rows.reduce((a, r) => a + r.revenue, 0)) ?? 0;
  const cash = round2(rows.reduce((a, r) => a + r.cash, 0)) ?? 0;
  const ufCash = round2(rows.reduce((a, r) => a + r.ufCash, 0)) ?? 0;

  const ctr = ratio(clicks, impressions);
  const cpm = ratio(spend, impressions);

  const counters = sumMetaCounters(rows);

  const row: CrmRow = {
    objectId: "total",
    name: "Total",
    effectiveStatus: null,
    statusKind: "other",
    parentName: null,
    campaignName: null,
    adsetName: null,
    objective: null,
    publicationUrl: null,
    adsCount: null,
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
    ...counters,
    ...metaRatios(counters, { spend, impressions }),

    leadsNew,
    leadsTotal,
    leadsWithBooking,
    bookings,
    attended,
    sales,
    revenue,
    cash,
    ufCash,
    ...crmRatios({ spend, leadsNew, leadsTotal, leadsWithBooking, bookings, attended, sales, revenue, cash, ufCash }),
  };
  return { row, leadsTotalIsSum: distinct === null };
}

/** La fila de total (sin el aviso). Ver `totalRowDetailed`. */
export function totalRow(rows: CrmRow[], optionsOrReach: TotalOptions | number | null = {}): CrmRow {
  const options: TotalOptions = typeof optionsOrReach === "object" && optionsOrReach !== null ? optionsOrReach : { overallReach: optionsOrReach };
  return totalRowDetailed(rows, options).row;
}

/**
 * ¿Hay que avisar que ningun contacto de este periodo trae datos de anuncio? Cuando se gasto plata y, aun asi, el CRM
 * no cuenta ni un lead, ni una agenda ni una venta de ningun anuncio: casi siempre es que los anuncios no mandan los
 * parametros de la URL (`utm_campaign={{campaign.id}}`...) y por eso ningun toque se puede vincular.
 */
export function showNoAdSignalNotice(total: CrmRow): boolean {
  return (total.spend ?? 0) > 0 && total.leadsNew === 0 && total.leadsTotal === 0 && total.bookings === 0 && total.sales === 0;
}

/** La nota al pie de la tabla: dice qué hace hoy la fila de total. */
export function totalFootnote(leadsTotalIsSum: boolean): string {
  const exact = "Leads nuevos, agendas y ventas se suman: es exacto, porque cada persona tiene un solo primer toque y cada agenda y cada venta cae en un solo anuncio."; // @plantilla-quitar(ventas)
  // @plantilla-sin(ventas): const exact = "Leads nuevos y agendas se suman: es exacto, porque cada persona tiene un solo primer toque y cada agenda cae en un solo anuncio.";
  const leads = leadsTotalIsSum
    ? "«Leads totales» del total suma las filas: puede contar dos veces a quien tocó varios anuncios."
    : "«Leads totales» del total cuenta a cada persona una sola vez, aunque haya tocado varios anuncios; el CPL total y Lead → Agenda del total usan ese número.";
  return `${exact} ${leads} Las agendas incluyen las canceladas (existieron y costaron); «Asistidas» muestra la calidad. Los cocientes dicen «—» cuando no se pueden calcular.`;
}

/**
 * Lo que dice la tarjeta «Leads CRM» del dashboard: de toda la cuenta, cuantas personas son NUEVAS (su primer toque fue un anuncio) y
 * cuantas TOTALES (con algun toque), y el costo por cada una. Sale de las filas por CAMPAÑA: cada persona tiene una sola campaña de
 * primer toque, asi que los nuevos son exactos; los totales son las personas DISTINTAS (si no llegaron, la suma de las campañas).
 */
export function crmLeadsSummary(args: { metrics: CrmMetrics[]; distinct: DistinctLeads | null; spend: number | null }): {
  leadsNew: number;
  leadsTotal: number;
  cplNew: number | null;
  cplTotal: number | null;
  leadsTotalIsSum: boolean;
} {
  const leadsNew = args.metrics.reduce((a, m) => a + m.leadsNew, 0);
  const leadsTotal = args.distinct ? args.distinct.leadsTotal : args.metrics.reduce((a, m) => a + m.leadsTotal, 0);
  return {
    leadsNew,
    leadsTotal,
    cplNew: round2(ratio(args.spend, leadsNew)),
    cplTotal: round2(ratio(args.spend, leadsTotal)),
    leadsTotalIsSum: args.distinct === null,
  };
}
