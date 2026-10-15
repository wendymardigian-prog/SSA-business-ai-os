/**
 * La lista de Finanzas > Recurrentes (GF16/GF17). PURO: arma las filas que se pintan (estado, frecuencia en
 * palabras, monto, equivalente mensual, próxima fecha de pago, proveedor, categoría, cobro y responsable), filtra
 * por estado y suma el resumen «Equivale a USD X por mes». Los componentes solo componen lo que sale de acá.
 *
 * La plata va en CÉNTIMOS enteros. La próxima fecha solo se calcula para las plantillas Activas: una pausada no
 * genera nada y una terminada ya no tiene fechas.
 */
import { categoryName, findCategory, type ExpenseCategory } from "./categories";
import { firstOccurrenceOnOrAfter, type CivilDate } from "./recurrence";
import {
  describeFrequency,
  monthlyEquivalent,
  recurringStatus,
  RECURRING_STATUS_LABELS,
  ruleFromRow,
  templateForEngine,
  type RecurringStatus,
  type RecurringTemplateRow,
} from "./recurring";
import { draftFromRow, type RecurringDraft } from "./recurring-form";
import { vendorLabel, type VendorLite } from "./vendors";
import { formatUsd } from "./format";
import { toCents } from "@/lib/sales/money";

/** Las columnas de `recurring_expenses` que lee la pantalla. */
export const RECURRING_LIST_COLUMNS =
  "id, concept, vendor_id, category_key, amount_type, amount, charge_mode, frequency, weekly_day, weekly_interval, monthly_day, yearly_month, yearly_day, start_date, end_date, lead_days, is_active, paused_at, generation_anchor, responsible_id, notes, updated_at";

/** La fila tal como llega de la base (con lo que la lista necesita además de la plantilla). */
export type RecurringDbRow = RecurringTemplateRow & { id: string; paused_at: string | null; updated_at: string };

export const ESTADO_FILTERS = ["activas", "pausadas", "terminadas", "todas"] as const;
export type EstadoFilter = (typeof ESTADO_FILTERS)[number];

export const ESTADO_LABELS: Record<EstadoFilter, string> = {
  activas: "Activas",
  pausadas: "Pausadas",
  terminadas: "Terminadas",
  todas: "Todas",
};

const FILTER_STATUS: Record<Exclude<EstadoFilter, "todas">, RecurringStatus> = {
  activas: "active",
  pausadas: "paused",
  terminadas: "finished",
};

/** `?estado=` → el filtro; cualquier otra cosa (o nada) es «Activas». */
export function parseEstadoFilter(value: string | string[] | null | undefined): EstadoFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return (ESTADO_FILTERS as readonly string[]).includes(v ?? "") ? (v as EstadoFilter) : "activas";
}

/** El link de un filtro (el de «Activas» es la dirección sin parámetros). */
export function estadoHref(filter: EstadoFilter): string {
  return filter === "activas" ? "/dashboard/finanzas/recurrentes" : `/dashboard/finanzas/recurrentes?estado=${filter}`;
}

export interface RecurringListItem {
  id: string;
  concept: string;
  status: RecurringStatus;
  statusLabel: string;
  /** «Mensual, el día 5». Si la fila está corrupta: un aviso. */
  frequencyText: string;
  /** «USD 36,00», «Variable» o «Variable (aprox. USD 50,00)». */
  amountLabel: string;
  isVariable: boolean;
  /** Equivalente mensual en céntimos (0 si es variable sin estimado). */
  monthlyCents: number;
  /** «USD 36,00» o «—». */
  monthlyLabel: string;
  /** La próxima fecha de pago (solo Activas). */
  nextDate: CivilDate | null;
  vendorName: string;
  categoryName: string;
  categoryColor: string;
  /** «Débito automático» · «A mano» · «A mano, 5 días antes». */
  chargeLabel: string;
  responsibleName: string | null;
  endDate: CivilDate | null;
  /** Lo que necesita el formulario para editarla. */
  draft: RecurringDraft;
  updatedAt: string;
}

export interface RecurringLookups {
  categories: readonly ExpenseCategory[];
  vendors: readonly VendorLite[];
  members: ReadonlyArray<{ id: string; name: string }>;
  todayLocal: CivilDate;
}

export function chargeLabel(mode: "automatic" | "manual", leadDays: number): string {
  if (mode === "automatic") return "Débito automático";
  if (!(leadDays > 0)) return "A mano";
  return `A mano, ${leadDays === 1 ? "1 día antes" : `${leadDays} días antes`}`;
}

export function amountLabel(row: Pick<RecurringTemplateRow, "amount_type" | "amount">): string {
  const cents = toCents(row.amount);
  if (row.amount_type === "variable") return cents > 0 ? `Variable (aprox. ${formatUsd(cents)})` : "Variable";
  return formatUsd(cents);
}

export function buildRecurringItem(row: RecurringDbRow, lookups: RecurringLookups): RecurringListItem {
  const status = recurringStatus(row, lookups.todayLocal);
  const rule = ruleFromRow(row);
  const engine = templateForEngine(row);
  const category = findCategory(lookups.categories, row.category_key);
  const monthlyCents = monthlyEquivalent(row);
  const member = row.responsible_id ? lookups.members.find((m) => m.id === row.responsible_id) : null;
  return {
    id: row.id,
    concept: row.concept,
    status,
    statusLabel: RECURRING_STATUS_LABELS[status],
    frequencyText: rule ? describeFrequency(rule) : "La frecuencia está incompleta: editala",
    amountLabel: amountLabel(row),
    isVariable: row.amount_type === "variable",
    monthlyCents,
    monthlyLabel: monthlyCents > 0 ? formatUsd(monthlyCents) : "—",
    nextDate: status === "active" && engine ? firstOccurrenceOnOrAfter(engine, lookups.todayLocal) : null,
    vendorName: row.vendor_id ? vendorLabel(lookups.vendors, row.vendor_id) : "Sin proveedor",
    categoryName: categoryName(lookups.categories, row.category_key),
    categoryColor: category?.color ?? "#78716c",
    chargeLabel: chargeLabel(row.charge_mode, row.lead_days),
    responsibleName: row.responsible_id ? (member?.name ?? "Persona que ya no está en el equipo") : null,
    endDate: row.end_date,
    draft: draftFromRow(row, row.id, row.updated_at),
    updatedAt: row.updated_at,
  };
}

const STATUS_RANK: Record<RecurringStatus, number> = { active: 0, paused: 1, finished: 2 };

/** Activas primero, por próxima fecha (las sin fecha al final); después pausadas y terminadas; empata el concepto. */
export function compareRecurring(a: RecurringListItem, b: RecurringListItem): number {
  if (a.status !== b.status) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (a.nextDate !== b.nextDate) {
    if (a.nextDate === null) return 1;
    if (b.nextDate === null) return -1;
    return a.nextDate < b.nextDate ? -1 : 1;
  }
  return a.concept.localeCompare(b.concept, "es");
}

export interface RecurringSummary {
  /** Suma de los equivalentes mensuales de las Activas, en céntimos. */
  monthlyCents: number;
  activeCount: number;
  /** Activas de monto variable sin estimado: no suman y se avisa. */
  variableWithoutEstimate: number;
  /** «Equivale a USD 1.240,00 por mes». */
  headline: string;
  /** La aclaración de abajo, o null. */
  note: string | null;
}

export function summarizeRecurring(items: readonly RecurringListItem[]): RecurringSummary {
  const active = items.filter((i) => i.status === "active");
  const monthlyCents = active.reduce((sum, i) => sum + i.monthlyCents, 0);
  const variableWithoutEstimate = active.filter((i) => i.isVariable && i.monthlyCents === 0).length;
  const note =
    variableWithoutEstimate > 0
      ? `${variableWithoutEstimate === 1 ? "1 plantilla de monto variable no tiene estimado y no suma" : `${variableWithoutEstimate} plantillas de monto variable no tienen estimado y no suman`}.`
      : null;
  return {
    monthlyCents,
    activeCount: active.length,
    variableWithoutEstimate,
    headline: `Equivale a ${formatUsd(monthlyCents)} por mes`,
    note,
  };
}

export type EstadoCounts = Record<EstadoFilter, number>;

export function countByEstado(items: readonly RecurringListItem[]): EstadoCounts {
  const counts: EstadoCounts = { activas: 0, pausadas: 0, terminadas: 0, todas: items.length };
  for (const i of items) {
    if (i.status === "active") counts.activas += 1;
    else if (i.status === "paused") counts.pausadas += 1;
    else counts.terminadas += 1;
  }
  return counts;
}

export interface RecurringListData {
  /** Las filas que se pintan (ya filtradas). */
  items: RecurringListItem[];
  estado: EstadoFilter;
  counts: EstadoCounts;
  /** Siempre sobre TODAS las activas, aunque el filtro muestre otras. */
  summary: RecurringSummary;
}

/** Arma todo lo que pinta la pantalla a partir de las filas de la base. */
export function buildRecurringList(rows: readonly RecurringDbRow[], lookups: RecurringLookups, estado: EstadoFilter): RecurringListData {
  const all = rows.map((r) => buildRecurringItem(r, lookups)).sort(compareRecurring);
  const items = estado === "todas" ? all : all.filter((i) => i.status === FILTER_STATUS[estado]);
  return { items, estado, counts: countByEstado(all), summary: summarizeRecurring(all) };
}

export interface RecurringScreenData extends RecurringListData {
  loadError: boolean;
  /** Había más plantillas que el tope: la lista y el resumen miran las primeras. */
  truncated: boolean;
  today: string;
  categories: ExpenseCategory[];
  vendors: VendorLite[];
  members: Array<{ id: string; name: string }>;
  canManage: boolean;
}
