/**
 * Las áreas que suman filtros y columnas a la lista de contactos. Cada una vive
 * en `./related/*` y se registra con UNA línea acá.
 *
 * Las de un módulo que la plantilla de estudiantes no lleva (Ventas,
 * Formularios, Tareas, Llamadas) van con su marca: el export saca la línea y
 * borra el archivo (`scripts/plantilla/perfiles/estudiantes.mjs`).
 */
import { CORE_FILTERS } from "./filters/catalog";
import type { ContactColumnDef, ContactFilterDef, ContactListModule } from "./filters/types";
import { CORE_COLUMNS } from "./columns-core";
import { attributionModule } from "./related/attribution";
import { touchesModule } from "./related/touches";
import { bookingsModule } from "./related/bookings";
import { conversationsModule } from "./related/conversations";
import { sequencesModule } from "./related/sequences";
import { formsModule } from "./related/forms"; // @plantilla-quitar(formularios)
import { salesModule } from "./related/sales"; // @plantilla-quitar(ventas)
import { tasksModule } from "./related/tasks"; // @plantilla-quitar(tareas)
import { callsModule } from "./related/calls"; // @plantilla-quitar(llamadas)

/** El orden de esta lista es el de las columnas en la tabla (los filtros se ordenan por grupo). */
export const CONTACT_LIST_MODULES: readonly ContactListModule[] = [
  attributionModule,
  touchesModule,
  bookingsModule,
  formsModule, // @plantilla-quitar(formularios)
  salesModule, // @plantilla-quitar(ventas)
  tasksModule, // @plantilla-quitar(tareas)
  conversationsModule,
  callsModule, // @plantilla-quitar(llamadas)
  sequencesModule,
];

/** Todos los filtros, en el orden en que aparecen (el panel los agrupa). */
export const CONTACT_FILTERS: readonly ContactFilterDef[] = [...CORE_FILTERS, ...CONTACT_LIST_MODULES.flatMap((m) => m.filters)];

/** Todas las columnas fijas del catálogo (los campos personalizados se suman en `columns.ts`). */
export const CONTACT_COLUMNS: readonly ContactColumnDef[] = [...CORE_COLUMNS, ...CONTACT_LIST_MODULES.flatMap((m) => m.columns)];

const BY_PARAM = new Map(CONTACT_FILTERS.map((f) => [f.param, f]));
export const filterByParam = (param: string) => BY_PARAM.get(param);

/** El área dueña de una columna (para cargarla por página). */
export function moduleOfColumn(key: string): ContactListModule | null {
  return CONTACT_LIST_MODULES.find((m) => m.columns.some((c) => c.key === key)) ?? null;
}
