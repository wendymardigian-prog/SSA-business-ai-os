// @plantilla-quitar(finanzas)
/**
 * Las columnas de Finanzas › Gastos para la tabla común (`DataTable`, docs/tablas.md). Nunca renombrar una `key`.
 */
import type { ColumnMeta } from "@/lib/ui/data-table/prefs";

export const EXPENSES_TABLE_KEY = "expenses";

export const EXPENSE_COLUMN_METAS: readonly ColumnMeta[] = [
  { key: "scheduled", label: "Programado", defaultWidth: 130 },
  { key: "concept", label: "Concepto", defaultWidth: 280, hideable: false },
  { key: "vendor", label: "Proveedor", defaultWidth: 180 },
  { key: "category", label: "Categoría", defaultWidth: 190 },
  { key: "amount", label: "Monto", defaultWidth: 130 },
  { key: "status", label: "Estado", defaultWidth: 160 },
  { key: "paid", label: "Pagado el", defaultWidth: 130 },
  { key: "actions", label: "", defaultWidth: 90, hideable: false, pinnable: false, resizable: false },
];
