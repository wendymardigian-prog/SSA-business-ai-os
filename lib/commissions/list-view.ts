/**
 * Lo que la pantalla de Comisiones decide antes de pintar (F59, F60). Puro: los componentes solo lo componen.
 * La selección, los grupos de la página, los links de la ficha y del CSV, y el aviso del tope del CSV.
 */
import { monthLabel } from "@/lib/finance/dates";
import { formatUsd } from "@/lib/finance/format";
import { commissionsHref, serializeCommissionFilters, type CommissionFilters, type CommissionGroupBy } from "./filters";
import type { CommissionListRow } from "./list-load";
import type { GroupSummary } from "./list-model";
import { EXCLUDED_MESSAGES, type NotSelectableCode, type SelectedCommission } from "./selection";
import { commissionStatusLabel } from "./status";

export const COMMISSIONS_CSV_LIMIT = 5000;
export const PAYOUT_MAX_IDS = 500;

const BASE = "/dashboard/finanzas/comisiones";

// ── Links ──────────────────────────────────────────────────────────────

/** La lista con los filtros de siempre y la ficha de una comisión abierta (`?commission=`). */
export function drawerHref(filters: CommissionFilters, id: string): string {
  const qs = new URLSearchParams(serializeCommissionFilters(filters));
  qs.set("commission", id);
  return `${BASE}?${qs.toString()}`;
}

/** La lista sin la ficha (conserva los filtros). */
export function closeDrawerHref(filters: CommissionFilters): string {
  return commissionsHref(filters);
}

/** El CSV con el mismo filtro de la lista (sin la página). */
export function exportHref(filters: CommissionFilters): string {
  const qs = serializeCommissionFilters({ ...filters, page: 1, groupBy: null });
  return `/api/v1/commissions/export${qs ? `?${qs}` : ""}`;
}

/** El aviso antes de bajar el CSV si el filtro tiene más filas que el tope. */
export function exportWarning(total: number): string | null {
  if (total <= COMMISSIONS_CSV_LIMIT) return null;
  return `Este filtro tiene ${total.toLocaleString("es-AR")} comisiones y el CSV trae como máximo ${COMMISSIONS_CSV_LIMIT.toLocaleString("es-AR")}. Acotá el filtro para bajar todo.`;
}

/** El link para ajustar las comisiones de un reembolso (lo usa la ficha de la venta). */
export function refundAdjustHref(paymentId: string): string {
  return `${BASE}?ajuste=${encodeURIComponent(paymentId)}`;
}

// ── Selección ──────────────────────────────────────────────────────────

export type Selection = ReadonlyMap<string, SelectedCommission>;

export function rowToSelected(row: Pick<CommissionListRow, "id" | "userId" | "amountCents" | "paidOn">): SelectedCommission {
  return { id: row.id, userId: row.userId, amountCents: row.amountCents, paidOn: row.paidOn };
}

export const isSelectableRow = (row: Pick<CommissionListRow, "notSelectable">): boolean => row.notSelectable === null;

/** El motivo (en palabras) por el que la casilla está deshabilitada, o null si se puede elegir. */
export function notSelectableMessage(code: NotSelectableCode | null): string | null {
  return code ? EXCLUDED_MESSAGES[code] : null;
}

export function toggleSelected(selection: Selection, row: Parameters<typeof rowToSelected>[0] & Pick<CommissionListRow, "notSelectable">): Selection {
  const next = new Map(selection);
  if (next.has(row.id)) next.delete(row.id);
  else if (isSelectableRow(row)) next.set(row.id, rowToSelected(row));
  return next;
}

/** Marca o desmarca todas las que se pueden elegir de un conjunto de filas (la página o un grupo). */
export function setManySelected(selection: Selection, rows: ReadonlyArray<Parameters<typeof rowToSelected>[0] & Pick<CommissionListRow, "notSelectable">>, on: boolean): Selection {
  const next = new Map(selection);
  for (const row of rows) {
    if (!isSelectableRow(row)) continue;
    if (on) next.set(row.id, rowToSelected(row));
    else next.delete(row.id);
  }
  return next;
}

/** `all` si todas las que se pueden elegir están elegidas, `some` si hay algunas, `none` si no hay ninguna (o nada elegible). */
export function selectionState(selection: Selection, rows: ReadonlyArray<Pick<CommissionListRow, "id" | "notSelectable">>): "none" | "some" | "all" {
  const selectable = rows.filter(isSelectableRow);
  if (selectable.length === 0) return "none";
  const chosen = selectable.filter((r) => selection.has(r.id)).length;
  return chosen === 0 ? "none" : chosen === selectable.length ? "all" : "some";
}

// ── Grupos de la página ────────────────────────────────────────────────

const NONE = "none";

/** La clave de grupo de una fila: la misma que usa el servidor para contar (`list-model.groupRows`). */
export function rowGroupKey(row: CommissionListRow, by: CommissionGroupBy): string {
  switch (by) {
    case "persona":
      return row.userId ?? NONE;
    case "rol":
      return row.role ?? NONE;
    case "mes":
      return row.paidOn ? row.paidOn.slice(0, 7) : NONE;
    case "producto":
      return row.productId ?? NONE;
    case "estado":
      return row.status.key;
    case "gasto":
      return row.expense?.expense_id ?? NONE;
  }
}

export interface GroupLookups {
  members: ReadonlyArray<{ id: string; name: string }>;
  roles: ReadonlyArray<{ key: string; name: string }>;
  products: ReadonlyArray<{ id: string; name: string }>;
}

/** El título de un grupo, en palabras. Los que no tienen valor se dicen: «Sin persona», «Sin gasto». */
export function groupLabel(by: CommissionGroupBy, key: string, rows: readonly CommissionListRow[], lookups: GroupLookups): string {
  const first = rows[0];
  switch (by) {
    case "persona":
      return key === NONE ? "Sin persona" : lookups.members.find((m) => m.id === key)?.name ?? first?.userName ?? "Otra persona";
    case "rol":
      return key === NONE ? "Sin rol (ajustes)" : lookups.roles.find((r) => r.key === key)?.name ?? first?.roleName ?? key;
    case "mes":
      return key === NONE ? "Sin fecha de cobro" : monthLabel(key);
    case "producto":
      return key === NONE ? "Sin producto" : lookups.products.find((p) => p.id === key)?.name ?? first?.productName ?? "Otro producto";
    case "estado":
      return commissionStatusLabel(key);
    case "gasto": {
      if (key === NONE) return "Sin gasto";
      const expense = first?.status;
      return expense?.detail ? `Gasto · ${expense.detail}` : "Gasto";
    }
  }
}

export interface PageGroup {
  key: string;
  label: string;
  rows: CommissionListRow[];
  /** Cuántas hay en TODO el filtro (no solo en esta página). */
  count: number;
  /** Lo que suman en TODO el filtro, en céntimos (las anuladas no suman, salvo al agrupar por estado). */
  cents: number;
}

/**
 * Las filas de la página repartidas en sus grupos. El orden es el del servidor (`groups`, lo más grande primero);
 * el conteo y el subtotal son los de todo el filtro, no los de la página. Si el servidor no trae un grupo (las
 * anuladas no suman al agrupar por algo que no es el estado), se cuenta con lo que hay en la página.
 */
export function groupPageRows(rows: readonly CommissionListRow[], by: CommissionGroupBy, groups: readonly GroupSummary[] | null, lookups: GroupLookups): PageGroup[] {
  const byKey = new Map<string, CommissionListRow[]>();
  for (const row of rows) {
    const key = rowGroupKey(row, by);
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  const order = (groups ?? []).map((g) => g.key);
  const keys = [...order.filter((k) => byKey.has(k)), ...[...byKey.keys()].filter((k) => !order.includes(k))];
  return keys.map((key) => {
    const list = byKey.get(key) ?? [];
    const summary = groups?.find((g) => g.key === key);
    return {
      key,
      label: groupLabel(by, key, list, lookups),
      rows: list,
      count: summary?.count ?? list.length,
      cents: summary?.cents ?? list.reduce((sum, r) => sum + r.amountCents, 0),
    };
  });
}

// ── Textos ─────────────────────────────────────────────────────────────

/** «Se generaron 2 gastos (USD 1.240,00). 1 comisión no entró: ya estaba en otro gasto.» */
export function payoutResultMessage(expenses: ReadonlyArray<{ amountCents: number }>, excluded: ReadonlyArray<{ message: string }>): string {
  const total = expenses.reduce((sum, e) => sum + e.amountCents, 0);
  const made =
    expenses.length === 0
      ? "No se generó ningún gasto."
      : `Se ${expenses.length === 1 ? "generó 1 gasto" : `generaron ${expenses.length} gastos`} (${formatUsd(total)}).`;
  if (excluded.length === 0) return made;
  const reasons = [...new Set(excluded.map((e) => e.message.charAt(0).toLowerCase() + e.message.slice(1)))];
  const count = excluded.length === 1 ? "1 comisión no entró" : `${excluded.length} comisiones no entraron`;
  return `${made} ${count}: ${reasons.join("; ")}.`;
}
