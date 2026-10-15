/**
 * El modelo de la lista de comisiones (F59). Puro: el cargador (`list-load.ts`) trae las filas livianas de todo el
 * filtro y acá se les calcula el estado, se aplican los filtros que dependen de él, se ordena, se cuenta y se
 * pagina. El estado de una comisión se DERIVA (depende del gasto y de la fecha de hoy), así que no se puede filtrar
 * en la consulta: por eso las pastillas, los totales por estado y la paginación se hacen sobre estas filas.
 */
import { monthKey } from "@/lib/finance/dates";
import { toCents } from "@/lib/sales/money";
import {
  COMMISSION_PILLS,
  COMMISSION_PILL_STATUSES,
  COMMISSIONS_PAGE_SIZE,
  totalsByStatus,
  type CommissionFilters,
  type CommissionGroupBy,
  type CommissionPill,
  type StatusTotals,
} from "./filters";
import { COMMISSION_STATUS_KEYS, commissionStatus, type CommissionStatusResult } from "./status";

/** Las columnas que la consulta liviana trae de `commissions`. */
export interface LightCommission {
  id: string;
  kind: "earned" | "adjustment";
  role: string | null;
  user_id: string | null;
  payment_id: string | null;
  sale_id: string | null;
  rule_id: string | null;
  amount: unknown;
  base_amount: unknown;
  paid_on: string | null;
  available_on: string;
  expense_id: string | null;
  voided_at: string | null;
  created_at: string;
}

/** Lo ÚNICO que el cargador devuelve de un gasto (el resto del gasto no sale de acá). */
export interface ExpenseRef {
  expense_id: string;
  status: string;
  scheduled_date: string | null;
  paid_date: string | null;
}

/** De la venta, lo que hace falta para filtrar y agrupar. */
export interface SaleLink {
  contact_id: string | null;
  product_id: string | null;
}

export interface ClassifiedRow {
  commission: LightCommission;
  amountCents: number;
  status: CommissionStatusResult;
  expense: ExpenseRef | null;
  contactId: string | null;
  productId: string | null;
}

export function classifyRows(
  rows: readonly LightCommission[],
  expenses: ReadonlyMap<string, ExpenseRef>,
  sales: ReadonlyMap<string, SaleLink>,
  todayLocal: string,
): ClassifiedRow[] {
  return rows.map((commission) => {
    const expense = commission.expense_id ? expenses.get(commission.expense_id) ?? null : null;
    const sale = commission.sale_id ? sales.get(commission.sale_id) ?? null : null;
    return {
      commission,
      amountCents: toCents(commission.amount),
      status: commissionStatus(commission, expense ? { status: expense.status, scheduled_date: expense.scheduled_date, paid_date: expense.paid_date } : null, todayLocal),
      expense,
      contactId: sale?.contact_id ?? null,
      productId: sale?.product_id ?? null,
    };
  });
}

/** ¿La fila entra en la pastilla? («Pagadas este mes»: el gasto que la liquidó se pagó en el mes de hoy.) */
export function inPill(row: ClassifiedRow, pill: CommissionPill, todayLocal: string): boolean {
  if (!COMMISSION_PILL_STATUSES[pill].includes(row.status.key)) return false;
  if (pill === "pagadas_mes") return !!row.expense?.paid_date && monthKey(row.expense.paid_date) === monthKey(todayLocal);
  return true;
}

/** Los filtros que dependen del estado derivado o de la venta: estado, pastilla, producto y contacto. */
export function applyDerivedFilters(
  rows: readonly ClassifiedRow[],
  filters: Pick<CommissionFilters, "statuses" | "pill" | "products" | "contactId">,
  todayLocal: string,
  options: { skipStatus?: boolean } = {},
): ClassifiedRow[] {
  return rows.filter((row) => {
    if (!options.skipStatus) {
      if (filters.statuses.length && !filters.statuses.includes(row.status.key)) return false;
      if (filters.pill && !inPill(row, filters.pill, todayLocal)) return false;
    }
    if (filters.products.length && !(row.productId && filters.products.includes(row.productId))) return false;
    if (filters.contactId && row.contactId !== filters.contactId) return false;
    return true;
  });
}

/** Lo más nuevo primero: fecha del cobro (sin fecha al final), después alta, después id. */
export function sortRows(rows: readonly ClassifiedRow[]): ClassifiedRow[] {
  return [...rows].sort((a, b) => {
    const pa = a.commission.paid_on ?? "";
    const pb = b.commission.paid_on ?? "";
    if (pa !== pb) return pa < pb ? 1 : -1;
    const ca = a.commission.created_at;
    const cb = b.commission.created_at;
    if (ca !== cb) return ca < cb ? 1 : -1;
    return a.commission.id < b.commission.id ? 1 : a.commission.id > b.commission.id ? -1 : 0;
  });
}

/** Cuenta y suma por pastilla, sobre las filas SIN el filtro de pastilla ni de estado. */
export function pillSummary(rows: readonly ClassifiedRow[], todayLocal: string): Record<CommissionPill, { count: number; cents: number }> {
  return Object.fromEntries(
    COMMISSION_PILLS.map((pill) => {
      const inside = rows.filter((row) => inPill(row, pill, todayLocal));
      return [pill, { count: inside.length, cents: inside.reduce((sum, row) => sum + row.amountCents, 0) }];
    }),
  ) as Record<CommissionPill, { count: number; cents: number }>;
}

export function statusTotals(rows: readonly ClassifiedRow[]): StatusTotals {
  return totalsByStatus(rows.map((row) => ({ status: row.status.key, amountCents: row.amountCents })));
}

export interface GroupSummary {
  /** El valor por el que se agrupa (id de persona, clave de rol, `AAAA-MM`, id de producto, clave de estado, id de gasto) o `none`. */
  key: string;
  count: number;
  cents: number;
}

const NONE = "none";

function groupKey(row: ClassifiedRow, by: CommissionGroupBy): string {
  switch (by) {
    case "persona":
      return row.commission.user_id ?? NONE;
    case "rol":
      return row.commission.role ?? NONE;
    case "mes":
      return row.commission.paid_on ? monthKey(row.commission.paid_on) : NONE;
    case "producto":
      return row.productId ?? NONE;
    case "estado":
      return row.status.key;
    case "gasto":
      return row.commission.expense_id ?? NONE;
  }
}

/** Una línea por grupo. Las anuladas no suman, salvo al agrupar por estado. */
export function groupRows(rows: readonly ClassifiedRow[], by: CommissionGroupBy): GroupSummary[] {
  const groups = new Map<string, GroupSummary>();
  for (const row of rows) {
    if (by !== "estado" && row.status.key === "anulada") continue;
    const key = groupKey(row, by);
    const slot = groups.get(key) ?? { key, count: 0, cents: 0 };
    slot.count += 1;
    slot.cents += row.amountCents;
    groups.set(key, slot);
  }
  const list = [...groups.values()];
  if (by === "mes") return list.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  if (by === "estado") return list.sort((a, b) => COMMISSION_STATUS_KEYS.indexOf(a.key as never) - COMMISSION_STATUS_KEYS.indexOf(b.key as never));
  return list.sort((a, b) => b.cents - a.cents || (a.key < b.key ? -1 : 1));
}

export function paginate<T>(rows: readonly T[], page: number, pageSize: number = COMMISSIONS_PAGE_SIZE): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { rows: rows.slice((current - 1) * pageSize, current * pageSize), page: current, pages };
}
