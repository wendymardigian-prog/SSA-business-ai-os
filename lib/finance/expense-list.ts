/**
 * Lo que muestra la lista de gastos (GF12): totales por estado en CÉNTIMOS, orden por defecto y agrupado.
 * Los totales se calculan sobre TODAS las filas del filtro (consulta de agregado aparte), no sobre la página.
 */
import { toCents } from "@/lib/sales/money";
import { EXPENSE_STATUS_KEYS, type ExpenseStatus } from "./expense-status";
import type { GroupBy } from "./expense-filters";

export interface ExpenseListRow {
  id: string;
  concept: string;
  vendor_id: string | null;
  category_key: string;
  amount: unknown;
  status: string;
  scheduled_date: string;
  paid_date: string | null;
  origin: string;
  receipt_path: string | null;
  responsible_id?: string | null;
  notes?: string | null;
  void_reason?: string | null;
  auto_drift_amount?: unknown;
  auto_drift_resolved_at?: string | null;
}

export interface StatusTotals {
  byStatus: Record<ExpenseStatus, { count: number; cents: number }>;
  /** Todo menos los anulados. */
  total: { count: number; cents: number };
}

export function totalsByStatus(rows: ReadonlyArray<Pick<ExpenseListRow, "status" | "amount">>): StatusTotals {
  const byStatus = Object.fromEntries(EXPENSE_STATUS_KEYS.map((s) => [s, { count: 0, cents: 0 }])) as StatusTotals["byStatus"];
  let count = 0;
  let cents = 0;
  for (const r of rows) {
    const bucket = byStatus[r.status as ExpenseStatus];
    const c = toCents(r.amount);
    if (bucket) {
      bucket.count += 1;
      bucket.cents += c;
    }
    if (r.status !== "anulado") {
      count += 1;
      cents += c;
    }
  }
  return { byStatus, total: { count, cents } };
}

/** Vencidos primero; después fecha programada ascendente (y el concepto, para que el orden sea estable). */
export function sortExpenses<T extends Pick<ExpenseListRow, "status" | "scheduled_date" | "concept" | "id">>(rows: readonly T[]): T[] {
  const rank = (s: string) => (s === "vencido" ? 0 : 1);
  return [...rows].sort((a, b) => rank(a.status) - rank(b.status) || a.scheduled_date.localeCompare(b.scheduled_date) || a.concept.localeCompare(b.concept) || a.id.localeCompare(b.id));
}

export interface ExpenseGroup<T> {
  key: string;
  label: string;
  rows: T[];
  cents: number;
}

/** Agrupa por categoría o proveedor con subtotal (sin anulados). El orden de los grupos es el del primer gasto. */
export function groupExpenses<T extends ExpenseListRow>(rows: readonly T[], by: GroupBy, labelOf: (key: string) => string): ExpenseGroup<T>[] {
  const groups = new Map<string, ExpenseGroup<T>>();
  for (const r of rows) {
    const key = by === "categoria" ? r.category_key : (r.vendor_id ?? "__sin_proveedor__");
    let g = groups.get(key);
    if (!g) {
      g = { key, label: labelOf(key), rows: [], cents: 0 };
      groups.set(key, g);
    }
    g.rows.push(r);
    if (r.status !== "anulado") g.cents += toCents(r.amount);
  }
  return [...groups.values()];
}

/** Cuántos días faltan o pasaron: "vence en 3 días", "venció hace 5 días". */
export function dueHint(scheduledDate: string, todayLocal: string, status: string): string | null {
  if (status === "pagado" || status === "anulado" || status === "por_revisar") return null;
  const diff = Math.round((Date.parse(scheduledDate) - Date.parse(todayLocal)) / 86_400_000);
  if (diff === 0) return "vence hoy";
  if (diff > 0) return `vence en ${diff} ${diff === 1 ? "día" : "días"}`;
  return `venció hace ${-diff} ${diff === -1 ? "día" : "días"}`;
}
