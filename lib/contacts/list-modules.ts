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
import { salesModule } from "./related/sales"; // @plantilla-quitar(ventas)

export const CONTACT_LIST_MODULES: readonly ContactListModule[] = [
  attributionModule,
  salesModule, // @plantilla-quitar(ventas)
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
