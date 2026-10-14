/**
 * Qué muestra la sección «Publicidad» del detalle de una pieza (Extra L, Tirón 2, A2).
 *
 * PURO: recibe los anuncios vinculados a la pieza y los números ya leídos (los insights de Meta y las filas de
 * `ads_crm_metrics_v2`, la MISMA función de la tabla Meta vs CRM) y decide qué se ve con 0, 1 o varios anuncios.
 * Nada de acá consulta la base ni redondea un dato que no existe: lo que no se puede calcular es `null` y la pantalla
 * muestra «—», nunca un cero inventado.
 */

export interface LinkedAd {
  adId: string;
  name: string | null;
  /** Estado efectivo de Meta (ACTIVE, PAUSED…), si el catálogo lo tiene. */
  status: string | null;
  adAccountId: string;
  /** Enlace al detalle del anuncio en el dashboard de Meta Ads. */
  href: string;
  /** El vínculo lo puso una persona (no el sync). */
  manual: boolean;
}

/** La pieza a la que está vinculado un anuncio (para el menú «⋯» del detalle del anuncio). */
export interface AdContentLink {
  pieceId: string;
  pieceTitle: string;
  /** El vínculo lo puso una persona (no el sync). */
  manual: boolean;
}

/** Una fila de `meta_ads_insights_daily` (nivel anuncio), solo lo que se suma. */
export interface InsightRow {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
}

/** Una fila de `ads_crm_metrics_v2`. */
export interface CrmRow {
  object_id: string | null;
  is_total: boolean;
  leads_first: number | null;
  leads_total: number | null;
  bookings: number | null;
  sales: number | null;
}

/** La suma de una columna; null si ninguna fila trae el dato (un cero afirmaría algo que Meta no dijo). */
export function sumColumn(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let any = false;
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      total += value;
      any = true;
    }
  }
  return any ? total : null;
}

/** Gasto dividido por cantidad. Null sin gasto, o con cero leads: no hay costo por algo que no pasó. */
export function costPer(spend: number | null, count: number | null): number | null {
  if (spend === null || count === null || count <= 0) return null;
  return spend / count;
}

export interface PieceAdsSummary {
  /** `none` = ningún anuncio vinculado: la sección no existe. */
  state: "none" | "single" | "multiple";
  ads: LinkedAd[];
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  leadsNew: number | null;
  leadsTotal: number | null;
  cplNew: number | null;
  cplTotal: number | null;
  bookings: number | null;
  sales: number | null;
  /** Avisos que la pantalla muestra debajo de los números. */
  notes: string[];
}

export const NOTE_CURRENCIES = "Los anuncios están en cuentas con monedas distintas: el gasto y el costo por lead no se pueden sumar.";
export const NOTE_NO_CRM = "No pude leer los leads, agendas y ventas en este momento.";
export const NOTE_DISTINCT = "Los leads totales cuentan una vez a quien tocó más de uno de estos anuncios.";

/**
 * Arma lo que se ve. `crm` = null cuando no se pudo leer (la sección se muestra igual con lo de Meta y lo avisa);
 * `currencyMixed` = los anuncios son de cuentas con monedas distintas.
 */
export function summarizePieceAds(input: {
  ads: LinkedAd[];
  insights: InsightRow[] | null;
  crm: CrmRow[] | null;
  currencyMixed?: boolean;
}): PieceAdsSummary {
  const ads = input.ads;
  const state: PieceAdsSummary["state"] = ads.length === 0 ? "none" : ads.length === 1 ? "single" : "multiple";
  const empty: PieceAdsSummary = {
    state,
    ads,
    spend: null,
    impressions: null,
    clicks: null,
    leadsNew: null,
    leadsTotal: null,
    cplNew: null,
    cplTotal: null,
    bookings: null,
    sales: null,
    notes: [],
  };
  if (state === "none") return empty;

  const notes: string[] = [];
  const insights = input.insights ?? [];
  const mixed = input.currencyMixed === true;
  const spend = mixed ? null : sumColumn(insights.map((r) => r.spend));
  if (mixed) notes.push(NOTE_CURRENCIES);

  let leadsNew: number | null = null;
  let leadsTotal: number | null = null;
  let bookings: number | null = null;
  let sales: number | null = null;
  if (input.crm === null) {
    notes.push(NOTE_NO_CRM);
  } else {
    const rows = input.crm.filter((r) => !r.is_total);
    const total = input.crm.find((r) => r.is_total) ?? null;
    leadsNew = sumColumn(rows.map((r) => r.leads_first)) ?? 0;
    bookings = sumColumn(rows.map((r) => r.bookings)) ?? 0;
    sales = sumColumn(rows.map((r) => r.sales)) ?? 0;
    // Personas distintas (la fila de total): una persona que tocó dos anuncios cuenta una vez. Sin esa fila, la suma.
    leadsTotal = total?.leads_total ?? sumColumn(rows.map((r) => r.leads_total)) ?? 0;
    if (state === "multiple") notes.push(NOTE_DISTINCT);
  }

  return {
    state,
    ads,
    spend,
    impressions: sumColumn(insights.map((r) => r.impressions)),
    clicks: sumColumn(insights.map((r) => r.clicks)),
    leadsNew,
    leadsTotal,
    cplNew: costPer(spend, leadsNew),
    cplTotal: costPer(spend, leadsTotal),
    bookings,
    sales,
    notes,
  };
}

/** ¿Las cuentas de estos anuncios tienen monedas distintas? Una cuenta sin moneda conocida no cuenta como distinta. */
export function hasMixedCurrencies(currencies: Array<string | null | undefined>): boolean {
  const known = new Set(currencies.filter((c): c is string => typeof c === "string" && c.trim() !== "").map((c) => c.trim().toUpperCase()));
  return known.size > 1;
}

/** El enlace al detalle de un anuncio en el dashboard de Meta Ads. */
export function adDetailHref(adId: string, adAccountId: string): string {
  return `/dashboard/dashboards/ads/ads/${encodeURIComponent(adId)}?cuenta=${encodeURIComponent(adAccountId)}`;
}

/** El texto de ayuda del menú de la pieza según lo que ya tiene vinculado. */
export function linkMenuLabels(linkedCount: number): { link: string; unlink: string | null } {
  return { link: "Vincular a un anuncio", unlink: linkedCount > 0 ? (linkedCount === 1 ? "Desvincular el anuncio" : "Desvincular un anuncio") : null };
}

export interface SummaryTile {
  key: "spend" | "impressions" | "clicks" | "leadsNew" | "leadsTotal" | "cplNew" | "cplTotal" | "bookings" | "sales";
  label: string;
  /** Ya formateado: «—» cuando el dato no existe (nunca un cero inventado). */
  value: string;
  tip: string;
}

/**
 * Los números de la sección «Publicidad», en el orden en que se leen: lo que se invirtió, lo que dio Meta y lo que pasó
 * en el CRM. Los textos de ayuda son los mismos que explican las columnas de la tabla Meta vs CRM.
 */
export function summaryTiles(
  summary: PieceAdsSummary,
  format: { money: (value: number | null) => string; count: (value: number | null) => string },
): SummaryTile[] {
  return [
    { key: "spend", label: "Gasto", value: format.money(summary.spend), tip: "Lo que se gastó en los anuncios vinculados a esta pieza en el período." },
    { key: "impressions", label: "Impresiones", value: format.count(summary.impressions), tip: "Veces que se mostraron los anuncios." },
    { key: "clicks", label: "Clics", value: format.count(summary.clicks), tip: "Clics en los anuncios (según Meta)." },
    { key: "leadsNew", label: "Leads nuevos", value: format.count(summary.leadsNew), tip: "Personas cuyo primer toque fue uno de estos anuncios. Una persona cuenta una sola vez en toda su vida." },
    { key: "leadsTotal", label: "Leads totales", value: format.count(summary.leadsTotal), tip: "Personas con algún toque de estos anuncios en el período, sean nuevas o no." },
    { key: "cplNew", label: "CPL nuevo", value: format.money(summary.cplNew), tip: "Gasto dividido por los leads nuevos." },
    { key: "cplTotal", label: "CPL total", value: format.money(summary.cplTotal), tip: "Gasto dividido por los leads totales." },
    { key: "bookings", label: "Agendas", value: format.count(summary.bookings), tip: "Reuniones agendadas por personas que vinieron de estos anuncios." },
    { key: "sales", label: "Ventas", value: format.count(summary.sales), tip: "Ventas atribuidas a estos anuncios." },
  ];
}

/**
 * ¿Aparece la sección «Publicidad» en el detalle de una pieza? Solo con al menos un anuncio vinculado: sin anuncio, el
 * detalle queda exactamente como estaba antes de esta función (la pantalla no dibuja nada).
 */
export function showAdsSection(ads: ReadonlyArray<LinkedAd>): boolean {
  return ads.length > 0;
}

/** ¿Aparece el indicador «Pautada» y el filtro en la lista de Contenido? Solo para quien puede ver anuncios. */
export function showPaidIndicator(canSeeAds: boolean, paid: boolean | undefined): boolean {
  return canSeeAds && paid === true;
}
