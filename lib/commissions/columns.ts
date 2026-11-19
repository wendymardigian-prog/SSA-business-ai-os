// @plantilla-quitar(comisiones)
/**
 * Las columnas de Finanzas › Comisiones para la tabla común (`DataTable`, docs/tablas.md). Nunca renombrar una `key`.
 */
import type { ColumnMeta } from "@/lib/ui/data-table/prefs";

export const COMMISSIONS_TABLE_KEY = "commissions";

export const COMMISSION_COLUMN_METAS: readonly ColumnMeta[] = [
  { key: "paid_on", label: "Cobro", defaultWidth: 120 },
  { key: "person", label: "Persona", defaultWidth: 170 },
  { key: "role", label: "Rol", defaultWidth: 140 },
  { key: "sale", label: "Venta", defaultWidth: 230 },
  { key: "payment", label: "Pago", defaultWidth: 130 },
  { key: "base", label: "Base", defaultWidth: 110 },
  { key: "calc", label: "% o fijo", defaultWidth: 100 },
  { key: "amount", label: "Monto", defaultWidth: 110, hideable: false },
  { key: "rule", label: "Regla", defaultWidth: 170 },
  { key: "status", label: "Estado", defaultWidth: 160 },
  { key: "expense", label: "Gasto", defaultWidth: 150 },
];

/** «Persona» no va en «Mis comisiones» (es siempre la misma). */
export function commissionColumnMetas(own: boolean): readonly ColumnMeta[] {
  return own ? COMMISSION_COLUMN_METAS.filter((c) => c.key !== "person") : COMMISSION_COLUMN_METAS;
}
