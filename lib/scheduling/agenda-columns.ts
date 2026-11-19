/**
 * Las columnas de la lista de Agenda para la tabla común (`DataTable`, docs/tablas.md): las de la reunión y las de
 * atribución (último click, UTM, Meta). PURO. Nunca renombrar una `key`: lo que cada persona eligió se guarda por clave.
 */
import { AGENDA_COLUMN_GROUPS, attributionColumnDefs } from "@/lib/attribution/columns";
import { attributionColumnMetas, type AttributionColumnMeta } from "@/lib/attribution/table-columns";
import type { AttributionCellSource } from "@/lib/attribution/columns";
import type { ColumnMeta } from "@/lib/ui/data-table/prefs";

export const AGENDA_TABLE_KEY = "agenda_list";

const BOOKING_GROUP = "Reunión";

export const AGENDA_BASE_COLUMNS: readonly ColumnMeta[] = [
  { key: "when", label: "Fecha y hora", group: BOOKING_GROUP, defaultWidth: 230 },
  // Fija al desplazar de costado: con tantas columnas, si no se pierde de quién es cada fila.
  { key: "contact", label: "Contacto", group: BOOKING_GROUP, defaultWidth: 190, hideable: false, defaultPinned: true },
  { key: "event", label: "Evento", group: BOOKING_GROUP, defaultWidth: 260 },
  { key: "category", label: "Categoría", group: BOOKING_GROUP, defaultWidth: 160 },
  { key: "host", label: "Anfitrión", group: BOOKING_GROUP, defaultWidth: 150 },
  { key: "status", label: "Estado", group: BOOKING_GROUP, defaultWidth: 200 },
  { key: "origin", label: "Origen", group: BOOKING_GROUP, defaultWidth: 120 },
];

/** Lo que se ve de atribución al abrir la lista; el resto se prende desde «Columnas». */
const DEFAULT_ATTRIBUTION: ReadonlySet<string> = new Set(["touch:last", "attr:utm_source", "attr:utm_campaign", "meta:campaign", "meta:adset", "meta:ad", "meta:status"]);

export function agendaAttributionColumns(): AttributionColumnMeta<AttributionCellSource>[] {
  return attributionColumnMetas(attributionColumnDefs(DEFAULT_ATTRIBUTION, { lastClick: true }), AGENDA_COLUMN_GROUPS);
}

/** Todas las columnas de la lista, en el orden normal. */
export function agendaColumnMetas(): ColumnMeta[] {
  return [...AGENDA_BASE_COLUMNS, ...agendaAttributionColumns()];
}
