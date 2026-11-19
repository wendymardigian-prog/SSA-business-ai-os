/**
 * Ordenar una tabla con un clic en el título (opcional en `DataTable`). Puro: la tabla dibuja y la pantalla decide cómo
 * ordena (en la consulta, en la URL, etc.).
 */

export type TableSortDir = "asc" | "desc";

export interface TableSort {
  key: string;
  dir: TableSortDir;
}

/** El orden después de un clic: la misma columna invierte; otra arranca con su sentido por defecto. */
export function nextSort(current: TableSort | null | undefined, key: string, defaultDir: TableSortDir): TableSort {
  if (current && current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: defaultDir };
}

/** Lo que va en `aria-sort` del título de una columna ordenable. */
export function ariaSort(current: TableSort | null | undefined, key: string): "ascending" | "descending" | "none" {
  if (!current || current.key !== key) return "none";
  return current.dir === "asc" ? "ascending" : "descending";
}
