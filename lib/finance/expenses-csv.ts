/**
 * El CSV de gastos (GF13). Los montos van con punto decimal y dos decimales (no el formato de pantalla), para
 * que una planilla los sume. NO lleva `payment_details` del proveedor (puede tener una cuenta bancaria).
 */
import { toCsv, type CsvValue } from "@/lib/csv/write";
import { categoryGroup, categoryName, CATEGORY_GROUP_LABELS, type ExpenseCategory } from "./categories";
import { expenseOriginLabel, expenseStatusLabel } from "./expense-status";
import type { ExpenseListRow } from "./expense-list";
import { fromCents, toCents } from "@/lib/shared/money";

export const EXPENSES_CSV_HEADER = [
  "id", "fecha_programada", "fecha_pago", "concepto", "proveedor", "categoria", "grupo", "estado", "origen", "monto_usd", "responsable", "comprobante", "notas", "motivo_anulacion",
] as const;

export const EXPENSES_CSV_LIMIT = 5000;

export interface CsvLookups {
  categories: readonly ExpenseCategory[];
  vendorName: (id: string | null) => string;
  memberName: (id: string | null) => string;
}

export function expensesToCsv(rows: readonly ExpenseListRow[], lookups: CsvLookups): string {
  const body: CsvValue[][] = rows.map((r) => [
    r.id,
    r.scheduled_date,
    r.paid_date ?? "",
    r.concept,
    lookups.vendorName(r.vendor_id),
    categoryName(lookups.categories, r.category_key),
    CATEGORY_GROUP_LABELS[categoryGroup(lookups.categories, r.category_key)],
    expenseStatusLabel(r.status),
    expenseOriginLabel(r.origin),
    fromCents(toCents(r.amount)).toFixed(2),
    lookups.memberName(r.responsible_id ?? null),
    r.receipt_path ? "si" : "no",
    r.notes ?? "",
    r.void_reason ?? "",
  ]);
  return toCsv(EXPENSES_CSV_HEADER, body);
}
