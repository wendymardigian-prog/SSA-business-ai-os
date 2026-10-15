/**
 * El listado de ventas (plano F25): filtros desde la URL, pastillas, columnas calculadas y
 * el chip de alcance. Puro: la página arma la consulta con esto y la RLS decide qué ve cada
 * persona (un Member con alcance `own` ve solo las suyas aunque la URL pida otro vendedor).
 */
import { isDateOnly } from "./dates";
import { ATTRIBUTION_TYPES, SALE_STATUSES } from "./labels";
import { saleBalance, salePaid } from "./sale-math";
import { describeAttribution, type SaleAttribution } from "./attribution";
import { CHANNELS, type TouchChannelKey } from "@/lib/contacts/taxonomy";
import { snapshotText } from "./sale-text";

export const SALES_PAGE_SIZE = 50;

export const PILLS = ["al_dia", "con_mora", "esta_semana", "canceladas"] as const;
export type Pill = (typeof PILLS)[number];

export const PILL_LABELS: Record<Pill, string> = {
  al_dia: "Al día",
  con_mora: "Con mora",
  esta_semana: "Por cobrar esta semana",
  canceladas: "Canceladas",
};

/** Los estados de cada pastilla (la de «esta semana» se resuelve por los pagos programados). */
export const PILL_STATUSES: Record<Exclude<Pill, "esta_semana">, readonly string[]> = {
  al_dia: ["pending_payment", "reserved", "paid", "subscription_active"],
  con_mora: ["overdue"],
  canceladas: ["cancelled", "subscription_cancelled", "refunded"],
};

export interface SalesFilters {
  pill: Pill | null;
  status: string[];
  productId: string | null;
  variantId: string | null;
  vendedorId: string | null;
  setterId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  attributionType: string | null;
  /** El canal del toque de la venta (Extra I, F49): `?canal=`. */
  channel: TouchChannelKey | null;
  /** La pieza de contenido del toque de la venta (Extra I, F49): `?pieza=<id>`. */
  pieceId: string | null;
  from: string | null;
  to: string | null;
  q: string | null;
  page: number;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | null => {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw.trim() ? raw.trim().slice(0, 120) : null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const many = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? v.split(",") : []).map((x) => x.trim()).filter(Boolean);

/** Arma los filtros desde la URL: lo desconocido se ignora. */
export function parseSalesFilters(params: Params): SalesFilters {
  const pill = one(params.pastilla);
  const type = one(params.atribucion);
  const channel = one(params.canal);
  const piece = one(params.pieza);
  const date = (key: string) => {
    const v = one(params[key]);
    return v && isDateOnly(v) ? v : null;
  };
  const page = Number(one(params.pagina));
  return {
    pill: (PILLS as readonly string[]).includes(pill ?? "") ? (pill as Pill) : null,
    status: many(params.estado).filter((s) => (SALE_STATUSES as readonly string[]).includes(s)),
    productId: one(params.producto),
    variantId: one(params.variante),
    vendedorId: one(params.vendedor),
    setterId: one(params.setter),
    utmSource: one(params.utm_source),
    utmMedium: one(params.utm_medium),
    utmCampaign: one(params.utm_campaign),
    attributionType: (ATTRIBUTION_TYPES as readonly string[]).includes(type ?? "") ? type : null,
    channel: (CHANNELS as readonly string[]).includes(channel ?? "") ? (channel as TouchChannelKey) : null,
    pieceId: piece && UUID.test(piece) ? piece : null,
    from: date("desde"),
    to: date("hasta"),
    q: one(params.q),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Un filtro de columna sobre `sales`, listo para aplicar a la consulta. */
export interface QueryFilter {
  column: string;
  op: "eq" | "in" | "gte" | "lte" | "ilike";
  value: string | string[];
}

/**
 * Los filtros que se aplican a la consulta de `sales`. Producto y variante filtran por el
 * SNAPSHOT (`product_snapshot->>product_id`): una venta de un producto archivado sigue
 * apareciendo. Los de atribución leen `attribution->>source|medium|campaign` (índices de la 00162).
 */
export function salesQueryFilters(f: SalesFilters): QueryFilter[] {
  const out: QueryFilter[] = [];
  const statuses = f.pill && f.pill !== "esta_semana" ? PILL_STATUSES[f.pill] : f.status;
  if (statuses.length > 0) out.push({ column: "status", op: "in", value: [...statuses] });
  if (f.productId) out.push({ column: "product_snapshot->>product_id", op: "eq", value: f.productId });
  if (f.variantId) out.push({ column: "product_snapshot->>variant_id", op: "eq", value: f.variantId });
  if (f.vendedorId) out.push({ column: "vendedor_id", op: "eq", value: f.vendedorId });
  if (f.setterId) out.push({ column: "setter_id", op: "eq", value: f.setterId });
  if (f.utmSource) out.push({ column: "attribution->>source", op: "eq", value: f.utmSource });
  if (f.utmMedium) out.push({ column: "attribution->>medium", op: "eq", value: f.utmMedium });
  if (f.utmCampaign) out.push({ column: "attribution->>campaign", op: "ilike", value: `%${f.utmCampaign.replace(/[%_,()]/g, " ")}%` });
  if (f.attributionType) out.push({ column: "attribution_type", op: "eq", value: f.attributionType });
  // El canal y la pieza viven en el TOQUE al que apunta la venta: se filtran sobre el recurso embebido (ver `touchEmbed`).
  if (f.channel) out.push({ column: `${TOUCH_EMBED}.channel`, op: "eq", value: f.channel });
  if (f.pieceId) out.push({ column: `${TOUCH_EMBED}.content_post_id`, op: "eq", value: f.pieceId });
  if (f.from) out.push({ column: "sale_date", op: "gte", value: f.from });
  if (f.to) out.push({ column: "sale_date", op: "lte", value: f.to });
  return out;
}

/** El recurso embebido del toque de la venta (`sales.attribution_touch_id`). */
export const TOUCH_EMBED = "contact_touches";

/**
 * La parte del `select` que trae el toque embebido. Con un filtro por canal o por pieza es un `inner` (solo quedan las
 * ventas cuyo toque cumple); sin filtro no se pide: el origen de cada fila se lee aparte, en una sola consulta.
 */
export function touchEmbed(f: Pick<SalesFilters, "channel" | "pieceId">): string {
  return f.channel || f.pieceId ? `, ${TOUCH_EMBED}!attribution_touch_id!inner(id)` : "";
}

export interface SaleListRowInput {
  id: string;
  sale_date: string;
  status: string;
  final_amount: unknown;
  product_snapshot: unknown;
  attribution: unknown;
  attribution_type: string;
  contact_id: string;
  vendedor_id: string | null;
}

export interface SaleListRow {
  id: string;
  contactId: string;
  saleDate: string;
  product: string;
  finalAmount: number;
  /** Cobrado neto y pendiente en dólares, calculados en céntimos (nunca sumas en flotante). */
  paid: number;
  pending: number;
  status: string;
  vendedorId: string | null;
  attribution: string;
  /** El origen de la venta (F49): el canal y una linea corta. Lo completa la pagina con el toque de la venta. */
  origin: { channel: string | null; channelLabel: string; summary: string };
}

/** Cobrado y pendiente salen de `saleBalance` en céntimos. */
export function saleListRow(
  sale: SaleListRowInput,
  payments: ReadonlyArray<{ amount: unknown; status: string }>,
  now: Date,
  timeZone: string,
): SaleListRow {
  const attribution = sale.attribution_type === "none" ? null : (sale.attribution as SaleAttribution | null);
  return {
    id: sale.id,
    contactId: sale.contact_id,
    saleDate: sale.sale_date,
    product: snapshotText(sale.product_snapshot),
    finalAmount: Number(sale.final_amount) || 0,
    paid: salePaid(payments),
    pending: saleBalance(sale.final_amount, payments),
    status: sale.status,
    vendedorId: sale.vendedor_id,
    origin: { channel: null, channelLabel: "Sin origen", summary: "Sin origen identificado" },
    attribution: attribution && (attribution.source || attribution.medium || attribution.campaign)
      ? [attribution.source, attribution.medium].filter(Boolean).join(" / ") + (attribution.campaign ? ` · ${attribution.campaign}` : "")
      : describeAttribution(null, now, timeZone),
  };
}

/** El chip de alcance: quién mira qué. */
export function scopeChip(hasAllScope: boolean): string {
  return hasAllScope ? "Todas las ventas del equipo" : "Solo tus ventas";
}

/** Los estados que se ofrecen en el filtro. */
export const STATUS_FILTER_OPTIONS = SALE_STATUSES;

/** Los filtros de vuelta a la URL (los que no están puestos no aparecen). Lo inverso de `parseSalesFilters`. */
export function salesFiltersToParams(f: SalesFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.pill) p.set("pastilla", f.pill);
  if (f.status.length > 0) p.set("estado", f.status.join(","));
  if (f.productId) p.set("producto", f.productId);
  if (f.variantId) p.set("variante", f.variantId);
  if (f.vendedorId) p.set("vendedor", f.vendedorId);
  if (f.setterId) p.set("setter", f.setterId);
  if (f.utmSource) p.set("utm_source", f.utmSource);
  if (f.utmMedium) p.set("utm_medium", f.utmMedium);
  if (f.utmCampaign) p.set("utm_campaign", f.utmCampaign);
  if (f.attributionType) p.set("atribucion", f.attributionType);
  if (f.channel) p.set("canal", f.channel);
  if (f.pieceId) p.set("pieza", f.pieceId);
  if (f.from) p.set("desde", f.from);
  if (f.to) p.set("hasta", f.to);
  if (f.q) p.set("q", f.q);
  if (f.page > 1) p.set("pagina", String(f.page));
  return p;
}

/** Cuántos filtros hay puestos (sin contar la pastilla ni la búsqueda ni la página): el globito de «Filtros». */
export function countActiveSalesFilters(f: SalesFilters): number {
  return [f.status.length > 0, f.productId, f.variantId, f.vendedorId, f.setterId, f.utmSource, f.utmMedium, f.utmCampaign, f.attributionType, f.channel, f.pieceId, f.from, f.to].filter(Boolean).length;
}
