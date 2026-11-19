/**
 * Las columnas de atribución (UTM, Meta, páginas, clics) para la tabla común (`DataTable`). PURO: traduce el catálogo de
 * `columns.ts` a lo que declara una tabla (`ColumnMeta`). El dibujo de la celda es `ColumnCellContent`. Lo usan la Agenda
 * y las respuestas de un formulario.
 */
import type { ColumnMeta } from "@/lib/ui/data-table/prefs";
import type { ColumnDef, ColumnGroup } from "./columns";

/** El ancho normal de una columna de atribución; las que se copian (una URL) arrancan más anchas. */
export const ATTRIBUTION_COLUMN_WIDTH = 160;
export const ATTRIBUTION_WIDE_COLUMN_WIDTH = 240;

export type AttributionColumnMeta<Row> = ColumnMeta & { def: ColumnDef<Row>; hint?: string };

export function attributionColumnMetas<Row>(defs: readonly ColumnDef<Row>[], groups: readonly ColumnGroup[]): AttributionColumnMeta<Row>[] {
  const groupLabel = new Map(groups.map((g) => [g.key, g.label]));
  return defs.map((def) => ({
    key: def.key,
    label: def.label,
    group: groupLabel.get(def.group) ?? def.group,
    defaultVisible: def.defaultVisible,
    defaultWidth: def.copyable || def.link ? ATTRIBUTION_WIDE_COLUMN_WIDTH : ATTRIBUTION_COLUMN_WIDTH,
    hint: def.hint,
    def,
  }));
}
