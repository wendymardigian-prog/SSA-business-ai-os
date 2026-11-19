/**
 * Las columnas de la lista de contactos para la tabla común (`DataTable`, docs/tablas.md). PURO: traduce el catálogo
 * (`columns.ts`: las fijas, las de cada área y los campos personalizados) a lo que declara una tabla, con un ancho normal
 * pensado para cada contenido. Nunca renombrar una `key`: lo que cada persona eligió se guarda por clave.
 */
import type { ColumnMeta } from "@/lib/ui/data-table/prefs";
import type { ContactColumnDef } from "./filters/types";

export const CONTACTS_TABLE_KEY = "contacts";

const WIDTHS: Record<string, number> = {
  name: 240,
  status: 170,
  contact: 230,
  setter: 150,
  vendedor: 150,
  product: 180,
  email_status: 150,
  tags: 260,
  last_interaction: 140,
  qualification: 150,
  setter_status: 170,
  closer_status: 170,
};

/** Columnas que muestran varias cosas y pueden ocupar más de una línea (el nombre con sus marcas, las etiquetas). */
export const WRAPPING_CONTACT_COLUMNS: ReadonlySet<string> = new Set(["name", "tags"]);

export type ContactColumnMeta = ColumnMeta & { def: ContactColumnDef };

export function contactColumnMetas(defs: readonly ContactColumnDef[]): ContactColumnMeta[] {
  return defs.map((def) => ({
    key: def.key,
    label: def.label,
    group: def.group.label,
    defaultVisible: def.defaultVisible || !def.hideable,
    hideable: def.hideable,
    defaultWidth: WIDTHS[def.key] ?? 160,
    def,
  }));
}
