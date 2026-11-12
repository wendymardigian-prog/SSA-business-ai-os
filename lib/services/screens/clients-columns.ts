// @plantilla-quitar(servicios)
/**
 * Las columnas de Clientes › Clientes (Servicios A2, F130.1) para la tabla comun (`DataTable`, docs/tablas.md). Nunca
 * renombrar una `key`: las vistas guardadas la usan.
 */
import type { ColumnMeta } from "@/lib/ui/data-table/prefs";

export const CLIENTS_TABLE_KEY = "service_clients";

export const CLIENT_COLUMN_METAS: readonly ColumnMeta[] = [
  { key: "name", label: "Cliente", defaultWidth: 240, hideable: false },
  { key: "light", label: "Semáforo", defaultWidth: 170 },
  { key: "active", label: "Servicios", defaultWidth: 120 },
  { key: "progress", label: "Avance", defaultWidth: 160 },
  { key: "login", label: "Último ingreso", defaultWidth: 160 },
  { key: "paid", label: "Total cobrado", defaultWidth: 140 },
];

/** Las columnas que se ofrecen: «Último ingreso» solo si algun producto tiene portal. */
export function clientColumnMetas(anyPortal: boolean): readonly ColumnMeta[] {
  return anyPortal ? CLIENT_COLUMN_METAS : CLIENT_COLUMN_METAS.filter((c) => c.key !== "login");
}
