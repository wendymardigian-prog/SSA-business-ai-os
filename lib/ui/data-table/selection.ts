/**
 * Selección de filas de `DataTable` (opcional: solo la prende la pantalla que pasa `selection`). PURO.
 * Lo elegido son ids; la casilla del encabezado mira solo las filas a la vista (la página).
 */

export type SelectionState = "none" | "some" | "all";

/** Cómo está la casilla del encabezado respecto de las filas a la vista. */
export function selectionState(selected: ReadonlySet<string>, visibleIds: readonly string[]): SelectionState {
  if (visibleIds.length === 0) return "none";
  let count = 0;
  for (const id of visibleIds) if (selected.has(id)) count++;
  if (count === 0) return "none";
  return count === visibleIds.length ? "all" : "some";
}

/** Prende o apaga una fila. Devuelve un conjunto nuevo. */
export function toggleRow(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** La casilla del encabezado: si ya están todas las de la vista, las saca; si no, las suma todas. */
export function toggleAllVisible(selected: ReadonlySet<string>, visibleIds: readonly string[]): Set<string> {
  const next = new Set(selected);
  if (selectionState(selected, visibleIds) === "all") for (const id of visibleIds) next.delete(id);
  else for (const id of visibleIds) next.add(id);
  return next;
}

/** Lo elegido que sigue a la vista (al cambiar de página o de filtro, lo que ya no se ve se suelta). */
export function keepVisible(selected: ReadonlySet<string>, visibleIds: readonly string[]): Set<string> {
  const visible = new Set(visibleIds);
  return new Set([...selected].filter((id) => visible.has(id)));
}
