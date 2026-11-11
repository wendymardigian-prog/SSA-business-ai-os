/**
 * Las columnas de la tabla de Pagos (sin el dibujo de las celdas, que vive en `components/sales/payments-list.tsx`).
 * El orden de acá es el normal; cada persona lo cambia desde el menú «Columnas» y lo guarda en una vista.
 */
import type { ColumnMeta } from "@/lib/ui/data-table/prefs";

export const PAYMENTS_TABLE_KEY = "payments";

export const PAYMENTS_COLUMN_METAS: readonly ColumnMeta[] = [
  { key: "due", label: "Vence", defaultWidth: 130 },
  { key: "contact", label: "Contacto", hideable: false, defaultWidth: 190 },
  { key: "product", label: "Producto", defaultWidth: 200 },
  { key: "variant", label: "Variante", defaultWidth: 140 },
  { key: "amount", label: "Monto", defaultWidth: 120 },
  { key: "status", label: "Estado", defaultWidth: 130 },
  { key: "delay", label: "Desfase", defaultWidth: 130 },
  { key: "method", label: "Método", defaultWidth: 140 },
  { key: "paidOn", label: "Cobrado el", defaultWidth: 130 },
  // Lo que cobra el procesador y lo que queda: apagadas de entrada, las pantallas hablan en bruto.
  { key: "fee", label: "Comisión", defaultVisible: false, defaultWidth: 120 },
  { key: "net", label: "Neto", defaultVisible: false, defaultWidth: 120 },
  { key: "actions", label: "", hideable: false, pinnable: false, resizable: false, defaultWidth: 200 },
];
