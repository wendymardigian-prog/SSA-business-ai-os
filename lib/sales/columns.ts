/**
 * Las columnas de la tabla de Ventas (sin el dibujo de las celdas, que vive en `components/sales/sales-list.tsx`).
 * El orden de acá es el normal; cada persona lo cambia desde el menú «Columnas» y lo guarda en una vista.
 */
import type { ColumnMeta } from "@/lib/ui/data-table/prefs";
import type { ModuleColumn } from "./module-columns";

export const SALES_TABLE_KEY = "sales";

export const SALES_COLUMN_METAS: readonly ColumnMeta[] = [
  { key: "date", label: "Fecha", defaultWidth: 140 },
  { key: "contact", label: "Contacto", hideable: false, defaultWidth: 200 },
  { key: "product", label: "Producto", defaultWidth: 210 },
  { key: "variant", label: "Variante", defaultWidth: 150 },
  { key: "amount", label: "Monto", defaultWidth: 120 },
  { key: "paid", label: "Cobrado", defaultWidth: 120 },
  { key: "pending", label: "Pendiente", defaultWidth: 120 },
  { key: "status", label: "Estado", defaultWidth: 170 },
  { key: "seller", label: "Vendedor", defaultWidth: 150 },
  { key: "attribution", label: "Atribución", defaultWidth: 240 },
  { key: "origin", label: "Origen", defaultWidth: 260 },
];

/** Las columnas con total al pie (plata, bruta). */
export const SALES_TOTAL_KEYS = ["amount", "paid", "pending"] as const;

/** La columna que suma un módulo (Servicios) se identifica con este prefijo, así nunca choca con una de BAIOS. */
export const moduleColumnKey = (column: Pick<ModuleColumn, "key">): string => `module:${column.key}`;

export const moduleColumnMeta = (column: ModuleColumn): ColumnMeta => ({ key: moduleColumnKey(column), label: column.header, defaultWidth: 200 });
