/**
 * Las columnas de la tabla «Meta vs CRM» (Extra L, AT4, F31): que es cada una, de que grupo, como se
 * formatea y su explicacion (el tooltip del encabezado).
 *
 * Tres grupos: **Meta** (lo que dice Meta), **Meta vs CRM** (lo que cuentan los dos, lado a lado) y **CRM**
 * (lo que paso despues del clic: leads, agendas, ventas, plata y los cocientes). Las definiciones estan en el
 * alcance v9, seccion 4.3. Una division por cero es «—».
 *
 * Modulo puro (sin React): el selector de columnas y la tabla leen de aca.
 */

import { count, money, percent } from "./ads";
import type { CrmRow } from "./ads-crm";

export type ColumnGroup = "meta" | "metaVsCrm" | "crm";

export const GROUP_ORDER: ColumnGroup[] = ["meta", "metaVsCrm", "crm"];

export const GROUP_LABEL: Record<ColumnGroup, string> = {
  meta: "Meta",
  metaVsCrm: "Meta vs CRM",
  crm: "CRM",
};

/** Una linea que explica de donde sale cada grupo (el tooltip del encabezado de color). */
export const GROUP_TIP: Record<ColumnGroup, string> = {
  meta: "Lo que mide Meta Ads: gasto, alcance, clics. No sabe qué pasó después del clic.",
  metaVsCrm: "Lo mismo contado por Meta y por tu CRM, lado a lado. Si no coinciden, el CRM es el que sabe quién llegó de verdad.",
  crm: "Lo que pasó en tu CRM con la gente que llegó de cada anuncio: leads, agendas, ventas y plata.",
};

export type ColumnKind = "money" | "count" | "percent" | "decimal";

export type ColumnId =
  // Meta
  | "spend" | "impressions" | "reach" | "frequency" | "clicks" | "ctr" | "cpm" | "cpc" | "cplMeta" | "conversions"
  // Meta vs CRM
  | "leadsMeta" | "leadsCrm" | "bookingsMeta" | "bookingsCrm"
  // CRM
  | "leadsFirst" | "leadsTotal" | "bookings" | "attended" | "leadToBooking" | "cplReal" | "costPerBooking"
  | "sales" | "revenue" | "cash" | "roas" | "roasCash" | "cac" | "costPerClose";

export interface ColumnDef {
  id: ColumnId;
  group: ColumnGroup;
  label: string;
  kind: ColumnKind;
  defaultVisible: boolean;
  tip: { title: string; body: string };
  /** El valor de la fila para esta columna, o null si no se puede calcular («—»). */
  value: (row: CrmRow) => number | null;
}

const AGENDAS_NOTE = " Cuenta también las agendas canceladas (existieron y costaron); «Asistidas» muestra la calidad. No cuenta las que se liberaron.";

export const COLUMNS: ColumnDef[] = [
  // ── Meta ──────────────────────────────────────────────────────────────
  { id: "spend", group: "meta", label: "Gasto", kind: "money", defaultVisible: true, value: (r) => r.spend, tip: { title: "Gasto", body: "Inversión total ejecutada en el período seleccionado." } },
  { id: "impressions", group: "meta", label: "Impr.", kind: "count", defaultVisible: true, value: (r) => r.impressions, tip: { title: "Impresiones", body: "Cantidad de veces que se mostró el anuncio. Una misma persona puede generar varias." } },
  { id: "reach", group: "meta", label: "Alcance", kind: "count", defaultVisible: false, value: (r) => r.reach, tip: { title: "Alcance", body: "Personas únicas que vieron el anuncio al menos una vez." } },
  { id: "frequency", group: "meta", label: "Frec.", kind: "decimal", defaultVisible: false, value: (r) => r.frequency, tip: { title: "Frecuencia", body: "Veces promedio que cada persona vio el anuncio. Impresiones ÷ Alcance." } },
  { id: "clicks", group: "meta", label: "Clics", kind: "count", defaultVisible: false, value: (r) => r.clicks, tip: { title: "Clics", body: "Total de clics en el anuncio en el período." } },
  { id: "ctr", group: "meta", label: "CTR", kind: "percent", defaultVisible: true, value: (r) => r.ctr, tip: { title: "CTR", body: "Porcentaje de quienes vieron el anuncio y hicieron clic. Clics ÷ Impresiones." } },
  { id: "cpm", group: "meta", label: "CPM", kind: "money", defaultVisible: false, value: (r) => r.cpm, tip: { title: "CPM", body: "Lo que pagás por cada 1.000 impresiones." } },
  { id: "cpc", group: "meta", label: "CPC", kind: "money", defaultVisible: false, value: (r) => r.cpc, tip: { title: "CPC", body: "Lo que cuesta cada clic. Gasto ÷ Clics." } },
  { id: "cplMeta", group: "meta", label: "CPL Meta", kind: "money", defaultVisible: false, value: (r) => r.cplMeta, tip: { title: "CPL con los leads de Meta", body: "Gasto ÷ leads que cuenta Meta. El costo por lead de verdad (con los leads del CRM) es «CPL real»." } },
  { id: "conversions", group: "meta", label: "Conv.", kind: "count", defaultVisible: false, value: (r) => r.conversions, tip: { title: "Conversiones", body: "Compras u otra conversión que Meta registra con el píxel o la API de conversiones." } },

  // ── Meta vs CRM ───────────────────────────────────────────────────────
  { id: "leadsMeta", group: "metaVsCrm", label: "Leads Meta", kind: "count", defaultVisible: true, value: (r) => r.leadsMeta, tip: { title: "Leads según Meta", body: "Leads que Meta cuenta (formulario nativo o evento de lead)." } },
  { id: "leadsCrm", group: "metaVsCrm", label: "Leads CRM", kind: "count", defaultVisible: true, value: (r) => r.leadsTotal, tip: { title: "Leads según el CRM", body: "Contactos con algún toque de este anuncio en el período (igual que «Leads totales»). Puede ser mayor que el de Meta: cuenta a quien llegó por un mensaje, una agenda o un formulario." } },
  { id: "bookingsMeta", group: "metaVsCrm", label: "Agendas Meta", kind: "count", defaultVisible: false, value: (r) => r.bookingsMeta, tip: { title: "Agendas según Meta", body: "Agendas que Meta registra (el evento «schedule» del píxel). Si Meta no manda ese evento, se muestra «—»." } },
  { id: "bookingsCrm", group: "metaVsCrm", label: "Agendas CRM", kind: "count", defaultVisible: false, value: (r) => r.bookings, tip: { title: "Agendas según el CRM", body: "Las mismas «Agendas» del grupo CRM, para compararlas con las de Meta." } },

  // ── CRM ───────────────────────────────────────────────────────────────
  { id: "leadsFirst", group: "crm", label: "Leads 1er toque", kind: "count", defaultVisible: false, value: (r) => r.leadsFirst, tip: { title: "Leads de primer toque", body: "Contactos cuyo PRIMER contacto con vos fue este anuncio, creados en el período. El crédito de quien lo trajo." } },
  { id: "leadsTotal", group: "crm", label: "Leads totales", kind: "count", defaultVisible: false, value: (r) => r.leadsTotal, tip: { title: "Leads totales", body: "Contactos con algún toque de este anuncio en el período (aunque no sea el primero). Un contacto que tocó dos anuncios cuenta en cada uno." } },
  { id: "bookings", group: "crm", label: "Agendas", kind: "count", defaultVisible: true, value: (r) => r.bookings, tip: { title: "Agendas", body: `Agendas creadas en el período cuyo toque es de este anuncio. Si la agenda no trae un toque con anuncio (manual, del agente o sin parámetros), se atribuye al último toque con anuncio del contacto anterior a la agenda.${AGENDAS_NOTE}` } },
  { id: "attended", group: "crm", label: "Asistidas", kind: "count", defaultVisible: false, value: (r) => r.attended, tip: { title: "Agendas asistidas", body: "De las agendas de arriba, las que llegaron a un resultado (seguimiento tibio o frío, venta o no calificado). Mide la calidad." } },
  { id: "leadToBooking", group: "crm", label: "Lead → Agenda", kind: "percent", defaultVisible: false, value: (r) => r.leadToBooking, tip: { title: "Lead → Agenda", body: "Contactos con agenda ÷ Leads totales. Cuántos de los que llegaron terminaron agendando." } },
  { id: "cplReal", group: "crm", label: "CPL real", kind: "money", defaultVisible: true, value: (r) => r.cplReal, tip: { title: "CPL real", body: "Gasto ÷ Leads totales del CRM. El costo por lead de verdad, no el que reporta Meta. «—» si no hay leads." } },
  { id: "costPerBooking", group: "crm", label: "Costo por agenda", kind: "money", defaultVisible: true, value: (r) => r.costPerBooking, tip: { title: "Costo por agenda", body: "Gasto ÷ Agendas. «—» si no hay agendas." } },
  { id: "sales", group: "crm", label: "Ventas", kind: "count", defaultVisible: true, value: (r) => r.sales, tip: { title: "Ventas", body: "Ventas no canceladas ni reembolsadas, con fecha de cierre en el período, cuyo toque de atribución es de este anuncio." } },
  { id: "revenue", group: "crm", label: "Revenue", kind: "money", defaultVisible: true, value: (r) => r.revenue, tip: { title: "Revenue", body: "Suma del total de esas ventas, en USD." } },
  { id: "cash", group: "crm", label: "Cash", kind: "money", defaultVisible: false, value: (r) => r.cash, tip: { title: "Cash", body: "Pagos cobrados en el período (menos reembolsos) de ventas de este anuncio, en USD." } },
  { id: "roas", group: "crm", label: "ROAS", kind: "decimal", defaultVisible: true, value: (r) => r.roas, tip: { title: "ROAS", body: "Revenue ÷ Gasto. Cuántos dólares de venta por cada dólar invertido. «—» si no hubo gasto." } },
  { id: "roasCash", group: "crm", label: "ROAS cash", kind: "decimal", defaultVisible: false, value: (r) => r.roasCash, tip: { title: "ROAS cash", body: "Cash ÷ Gasto. Lo mismo, pero con la plata que ya entró." } },
  { id: "cac", group: "crm", label: "CAC", kind: "money", defaultVisible: false, value: (r) => r.cac, tip: { title: "CAC", body: "Costo de adquisición de cliente. Gasto ÷ Ventas. «—» si no hubo ventas." } },
  { id: "costPerClose", group: "crm", label: "Costo por cierre", kind: "money", defaultVisible: false, value: (r) => r.costPerClose, tip: { title: "Costo por cierre", body: "Gasto ÷ Ventas. «—» si no hubo ventas." } },
];

export const COLUMN_BY_ID: Record<ColumnId, ColumnDef> = Object.fromEntries(COLUMNS.map((c) => [c.id, c])) as Record<ColumnId, ColumnDef>;

export const ALL_COLUMN_IDS: ColumnId[] = COLUMNS.map((c) => c.id);

/** Las columnas de un grupo, en su orden por defecto. */
export const columnsOfGroup = (group: ColumnGroup): ColumnDef[] => COLUMNS.filter((c) => c.group === group);

/** Una celda, formateada. «—» cuando no se puede calcular. */
export function formatCell(def: ColumnDef, row: CrmRow, currency: string | null): string {
  const value = def.value(row);
  if (value === null) return "—";
  switch (def.kind) {
    case "money":
      return money(value, currency, { narrow: true });
    case "percent":
      return percent(value);
    case "decimal":
      return value.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    default:
      return count(value);
  }
}

/** Una celda para el CSV: el numero tal cual (punto decimal, sin simbolo), o vacio si no se puede calcular. */
export function csvCell(def: ColumnDef, row: CrmRow): string {
  const value = def.value(row);
  return value === null ? "" : String(value);
}
