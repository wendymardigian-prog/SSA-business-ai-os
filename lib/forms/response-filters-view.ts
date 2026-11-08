/**
 * Lo que la barra de Respuestas muestra de los filtros puestos: cuántos hay en el menú y los chips
 * para sacarlos de a uno. Puro: la pantalla solo lo compone.
 *
 * Cada chip trae los cambios de URL que lo sacan (`clear`), para que la pantalla no arme
 * parámetros a mano.
 */
import { DIMENSION_LABELS, dimensionValueLabel, type DimensionFilters, type ResponseDimension } from "./response-index";
import { DIMENSION_PARAM, SUBMISSION_STATUS_LABELS, type SubmissionStatus } from "./responses";

export interface ResponseViewFilters {
  status: SubmissionStatus | "all";
  contact: "with" | "without" | "all";
  dims: DimensionFilters;
}

export interface ResponseFilterChip {
  key: string;
  label: string;
  /** Los parámetros de la URL que lo sacan (null = borrar). */
  clear: Record<string, string | null>;
}

/** Los filtros del menú «Filtros» que están puestos (no cuentan la búsqueda, la fecha ni agrupar). */
export function countMenuFilters(filters: ResponseViewFilters, dimensions: readonly ResponseDimension[]): number {
  return (
    (filters.status !== "all" ? 1 : 0) +
    (filters.contact !== "all" ? 1 : 0) +
    dimensions.filter((d) => (filters.dims[d]?.length ?? 0) > 0).length
  );
}

/** Un valor de una dimensión, escrito en la URL (varios separados por coma; vacío = sacar el filtro). */
export function dimensionParam(values: readonly string[]): string | null {
  return values.length ? values.join(",") : null;
}

export function filterChips(filters: ResponseViewFilters, dimensions: readonly ResponseDimension[]): ResponseFilterChip[] {
  const chips: ResponseFilterChip[] = [];
  if (filters.status !== "all") {
    chips.push({ key: "estado", label: `Estado: ${SUBMISSION_STATUS_LABELS[filters.status]}`, clear: { estado: null } });
  }
  if (filters.contact !== "all") {
    chips.push({ key: "contacto", label: filters.contact === "with" ? "Con contacto" : "Sin contacto", clear: { contacto: null } });
  }
  for (const dimension of dimensions) {
    const values = filters.dims[dimension] ?? [];
    if (!values.length) continue;
    const names = values.map((v) => dimensionValueLabel(dimension, v));
    const shown = names.length <= 2 ? names.join(", ") : `${names.length} elegidos`;
    chips.push({ key: dimension, label: `${DIMENSION_LABELS[dimension]}: ${shown}`, clear: { [DIMENSION_PARAM[dimension]]: null } });
  }
  return chips;
}

/** Sacar todos los filtros del menú: quedan la búsqueda, la fecha y agrupar. */
export function clearMenuFilters(dimensions: readonly ResponseDimension[]): Record<string, string | null> {
  return Object.assign({ estado: null, contacto: null }, ...dimensions.map((d) => ({ [DIMENSION_PARAM[d]]: null })));
}

/**
 * Tocar un grupo del resumen: muestra solo esas respuestas (el filtro de esa dimensión pasa a ser
 * ese valor) y vuelve a la lista.
 */
export function selectGroup(dimension: ResponseDimension, value: string): Record<string, string | null> {
  return { [DIMENSION_PARAM[dimension]]: value, agrupar: null };
}
