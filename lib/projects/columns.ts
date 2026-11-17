// @plantilla-quitar(proyectos)
/**
 * Las columnas de Proyectos y facturación (Corrida C) para la tabla común (`DataTable`, docs/tablas.md). Nunca renombrar
 * una `key`: las preferencias guardadas la usan.
 */
import type { ColumnMeta } from "@/lib/ui/data-table/prefs";

export const PAYMENTS_TABLE_KEY = "projects_payments";
export const PROJECTS_TABLE_KEY = "projects_list";

export const PAYMENT_COLUMN_METAS: readonly ColumnMeta[] = [
  { key: "date", label: "Fecha", defaultWidth: 110 },
  { key: "student", label: "Estudiante", defaultWidth: 180, hideable: false },
  { key: "payment", label: "Pago", defaultWidth: 280 },
  { key: "amount", label: "Monto", defaultWidth: 120 },
  { key: "state", label: "Estado", defaultWidth: 150 },
  { key: "actions", label: "Acciones", defaultWidth: 230, hideable: false, pinnable: false, resizable: false },
];

export const PROJECT_COLUMN_METAS: readonly ColumnMeta[] = [
  { key: "project", label: "Proyecto", defaultWidth: 240, hideable: false },
  { key: "student", label: "Estudiante", defaultWidth: 180 },
  { key: "kind", label: "Tipo y estado", defaultWidth: 180 },
  { key: "sold", label: "Vendido", defaultWidth: 120 },
  { key: "paid", label: "Cobrado", defaultWidth: 120 },
  { key: "steps", label: "Pasos listos", defaultWidth: 110 },
];
