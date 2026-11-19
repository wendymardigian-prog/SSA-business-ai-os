// @plantilla-quitar(servicios)
/**
 * Las columnas de Clientes › Servicios para la tabla común (`DataTable`, docs/tablas.md). Nunca renombrar una `key`: lo que
 * cada persona eligió se guarda por clave.
 */
import type { ColumnMeta } from "@/lib/ui/data-table/prefs";

export const SERVICES_TABLE_KEY = "services_list";

export const SERVICE_COLUMN_METAS: readonly ColumnMeta[] = [
  { key: "client", label: "Cliente", defaultWidth: 240, hideable: false },
  { key: "product", label: "Producto · variante", defaultWidth: 240 },
  { key: "owner", label: "Responsable", defaultWidth: 160 },
  { key: "light", label: "Semáforo", defaultWidth: 220 },
  { key: "phase", label: "Fase", defaultWidth: 160 },
  { key: "day", label: "Día", defaultWidth: 120 },
  { key: "progress", label: "Avance", defaultWidth: 100 },
  { key: "portal", label: "Portal", defaultWidth: 140 },
];

/** «Portal» solo si algún producto tiene portal. */
export function serviceColumnMetas(anyPortal: boolean): readonly ColumnMeta[] {
  return anyPortal ? SERVICE_COLUMN_METAS : SERVICE_COLUMN_METAS.filter((c) => c.key !== "portal");
}
