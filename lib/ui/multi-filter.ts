/**
 * Las reglas del filtro de varias opciones (`components/ui/multi-filter-field.tsx`).
 * Puras: el componente solo las compone.
 */

export interface MultiFilterOption {
  value: string;
  label: string;
  /** Un punto de color a la izquierda (estados del pipeline). */
  color?: string | null;
}

/** Desde cuántas opciones aparece el buscador. */
export const MULTI_FILTER_SEARCH_FROM = 9;

/** Lo que se ve con el filtro cerrado. */
export function multiFilterSummary(selected: readonly string[], labelOf: (value: string) => string): string {
  if (selected.length === 0) return "Todos";
  if (selected.length <= 2) return selected.map(labelOf).join(", ");
  return `${selected.length} elegidos`;
}

/** Sin acentos ni mayúsculas: «Mentoría» se encuentra escribiendo «mentoria». */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Las opciones que quedan con lo escrito en el buscador. */
export function filterOptions<T extends { label: string }>(options: readonly T[], query: string): T[] {
  const q = foldText(query.trim());
  if (!q) return [...options];
  return options.filter((o) => foldText(o.label).includes(q));
}
