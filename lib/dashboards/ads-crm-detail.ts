/**
 * El detalle de una celda de la tabla «Meta vs CRM» (Tirón 2, B2): las personas o los registros que forman un número.
 *
 * Al hacer clic en «Leads nuevos», «Leads totales», «Agendas» o «Ventas» se abre un panel con la lista, de a 50. La lista sale
 * de la MISMA función de la base que el número (`ads_crm_items`, 00219), así que la cantidad de la lista es siempre el número de la
 * celda. Acá solo se arma lo que se muestra: títulos, textos y a dónde lleva cada ítem (la ficha, la agenda o la venta).
 *
 * Módulo puro: lo prueba `ads-crm-detail.test.ts`.
 */

import type { CellMetric } from "./ads-crm-columns";

export const PAGE_SIZE = 50;

export const CELL_METRICS: readonly CellMetric[] = ["leads_new", "leads_total", "bookings", "sales"];

export const isCellMetric = (value: unknown): value is CellMetric => typeof value === "string" && (CELL_METRICS as readonly string[]).includes(value);

export interface DetailItem {
  itemId: string | null;
  contactId: string | null;
  contactName: string | null;
  /** La fecha del toque. */
  occurredAt: string | null;
  origin: string | null;
  /** Agendas: cuándo es la reunión. Ventas: la fecha de la venta. */
  detailAt: string | null;
  amountCents: number | null;
}

export interface DetailPage {
  items: DetailItem[];
  /** Cuántos hay en total (el número de la celda), no solo en esta página. */
  total: number;
}

export interface DetailRpcRow {
  item_id: string | null;
  contact_id: string | null;
  contact_name: string | null;
  occurred_at: string | null;
  origin: string | null;
  detail_at: string | null;
  amount_cents: number | string | null;
  total_count: number | string | null;
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function mapDetailRows(rows: DetailRpcRow[] | null | undefined): DetailPage {
  const list = rows ?? [];
  return {
    total: list.length > 0 ? (num(list[0].total_count) ?? list.length) : 0,
    items: list.map((r) => ({
      itemId: r.item_id,
      contactId: r.contact_id,
      contactName: r.contact_name,
      occurredAt: r.occurred_at,
      origin: r.origin,
      detailAt: r.detail_at,
      amountCents: num(r.amount_cents),
    })),
  };
}

export const hasMore = (loaded: number, total: number): boolean => loaded < total;

const METRIC_LABEL: Record<CellMetric, string> = {
  leads_new: "Leads nuevos",
  leads_total: "Leads totales",
  bookings: "Agendas",
  sales: "Ventas",
};

export const metricLabel = (metric: CellMetric): string => METRIC_LABEL[metric];

/** «Leads nuevos · Anuncio X» o «Leads nuevos · Total». */
export function panelTitle(metric: CellMetric, objectName: string | null): string {
  return `${METRIC_LABEL[metric]} · ${objectName?.trim() || "Total"}`;
}

/** Una línea que explica qué se está viendo. */
export function panelHint(metric: CellMetric): string {
  switch (metric) {
    case "leads_new":
      return "Personas cuyo primer contacto con vos fue por acá, creadas en el período. Cada una cuenta una sola vez.";
    case "leads_total":
      return "Personas con algún toque en el período. Una persona que tocó más de un anuncio aparece en cada uno.";
    case "bookings":
      return "Agendas creadas en el período (incluye las canceladas; no las liberadas).";
    case "sales":
      return "Ventas no canceladas ni reembolsadas, con fecha de cierre en el período.";
  }
}

export function emptyMessage(metric: CellMetric): string {
  switch (metric) {
    case "leads_new":
      return "Ningún lead nuevo en este período.";
    case "leads_total":
      return "Ningún lead con toques en este período.";
    case "bookings":
      return "Ninguna agenda en este período.";
    case "sales":
      return "Ninguna venta en este período.";
  }
}

const ORIGIN_LABEL: Record<string, string> = {
  dm: "Mensaje directo",
  comment: "Comentario",
  booking: "Agenda",
  form: "Formulario",
  webhook: "Webhook",
  manual: "Carga manual",
  import: "Importación",
};

export const originLabel = (origin: string | null): string | null => (origin ? (ORIGIN_LABEL[origin] ?? origin) : null);

/**
 * A donde lleva un ítem: un lead, a la ficha del contacto; una agenda, a su detalle en la Agenda; una venta, a su pantalla.
 * Son las rutas que ya existen (`lib/audit-query.ts`).
 */
export function itemHref(metric: CellMetric, item: DetailItem): string | null {
  if (metric === "bookings") return item.itemId ? `/dashboard/agenda?agenda=${item.itemId}` : null;
  if (metric === "sales") return item.itemId ? `/dashboard/ventas/${item.itemId}` : null;
  return item.contactId ? `/dashboard/contacts/${item.contactId}` : null;
}

export function itemTitle(metric: CellMetric, item: DetailItem): string {
  if (item.contactName?.trim()) return item.contactName.trim();
  return metric === "sales" ? "Venta sin nombre de contacto" : "Contacto sin nombre";
}

const dateFmt = (iso: string | null, timeZone: string, withTime: boolean): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", ...(withTime ? { timeStyle: "short" } : {}), timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

/** Las líneas chicas de debajo del nombre: la fecha del toque, el origen y, según la métrica, la reunión o el monto. */
export function itemDetails(metric: CellMetric, item: DetailItem, opts: { timeZone: string; formatMoney: (amount: number) => string }): string[] {
  const out: string[] = [];
  const touch = dateFmt(item.occurredAt, opts.timeZone, true);
  if (touch) out.push(`Toque: ${touch}`);
  const origin = originLabel(item.origin);
  if (origin) out.push(`Origen: ${origin}`);
  if (metric === "bookings") {
    const meeting = dateFmt(item.detailAt, opts.timeZone, true);
    if (meeting) out.push(`Reunión: ${meeting}`);
  }
  if (metric === "sales") {
    if (item.amountCents !== null) out.push(`Monto: ${opts.formatMoney(item.amountCents / 100)}`);
    const sale = dateFmt(item.detailAt, opts.timeZone, false);
    if (sale) out.push(`Venta: ${sale}`);
  }
  return out;
}

/** Una celda se abre solo si tiene algo para mostrar: un 0 no abre un panel vacío. */
export const canOpenCell = (cell: CellMetric | undefined, value: number | null): boolean => !!cell && typeof value === "number" && value > 0;

/** Las fechas civiles que acepta el panel (AAAA-MM-DD). */
export const isCivilDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
