import { compareRows, compareKeys, isAfterCursor, type CursorRow, type ListCursor } from "@/lib/inbox/list-cursor";

/**
 * Lo que la lista de la bandeja tiene cargado y como se combina con lo que llega
 * (scroll infinito y tiempo real, 27/11/2026). Modulo PURO: los componentes solo
 * lo llaman.
 */

export interface LoadedList<R extends CursorRow> {
  rows: R[];
  /** Donde arranca la tanda siguiente (lo dio el servidor). */
  cursor: ListCursor | null;
  hasMore: boolean;
}

/**
 * La pagina se volvio a pedir (un `router.refresh()` del hilo, una accion, una
 * reconexion) y trae la primera tanda fresca. Con los mismos filtros, lo que la
 * persona ya habia bajado NO se pierde: arriba va lo fresco y abajo lo que ya
 * estaba cargado despues de eso.
 */
export function mergeFreshFirstChunk<R extends CursorRow>(prev: LoadedList<R>, fresh: LoadedList<R>): LoadedList<R> {
  // Lo fresco ya trae todo, o lo cargado no pasaba de la primera tanda.
  if (!fresh.hasMore || !fresh.cursor || !prev.cursor) return fresh;
  if (compareKeys(prev.cursor, fresh.cursor) <= 0) return fresh;
  const freshIds = new Set(fresh.rows.map((r) => r.id));
  const older = prev.rows.filter((r) => !freshIds.has(r.id) && isAfterCursor(r, fresh.cursor!));
  return { rows: [...fresh.rows, ...older].sort(compareRows), cursor: prev.cursor, hasMore: prev.hasMore };
}

export interface FetchedResult<R extends CursorRow> {
  state: LoadedList<R>;
  /** Los ids que entraron a la lista y no estaban. */
  added: string[];
  /** Los ids que estaban y salieron. */
  removed: string[];
}

/**
 * Llegaron del servidor los chats que cambiaron en vivo: `rows` cumplen los
 * filtros (como estan ahora) y `notMatching` ya no.
 *
 * Una fila que cae mas abajo de lo cargado no se agrega: aparece sola al bajar,
 * en su lugar. Si ya no hay nada mas para cargar, entra igual.
 */
export function applyFetchedRows<R extends CursorRow>(
  state: LoadedList<R>,
  rows: R[],
  notMatching: string[],
): FetchedResult<R> {
  const before = new Set(state.rows.map((r) => r.id));
  const drop = new Set([...notMatching, ...rows.map((r) => r.id)]);
  const kept = state.rows.filter((r) => !drop.has(r.id));
  const fits = (r: R) => !state.hasMore || !state.cursor || !isAfterCursor(r, state.cursor);
  const next = [...kept, ...rows.filter(fits)].sort(compareRows);
  const after = new Set(next.map((r) => r.id));
  return {
    state: { ...state, rows: next },
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
  };
}

/** Una tanda mas al final (sin repetir lo que ya estaba, por si entro en vivo mientras tanto). */
export function appendChunk<R extends CursorRow>(state: LoadedList<R>, chunk: LoadedList<R>): LoadedList<R> {
  const have = new Set(state.rows.map((r) => r.id));
  return {
    rows: [...state.rows, ...chunk.rows.filter((r) => !have.has(r.id))].sort(compareRows),
    cursor: chunk.cursor ?? state.cursor,
    hasMore: chunk.hasMore,
  };
}

/**
 * Un cambio en vivo de una fila que ya se ve y sigue cumpliendo los filtros: se
 * aplica en el acto y la fila se reacomoda (un mensaje nuevo la sube arriba).
 */
export function mergeVisibleUpdate<R extends CursorRow>(rows: R[], patch: Partial<R> & { id: string }): R[] {
  return rows.map((r) => (r.id === patch.id ? { ...r, ...patch } : r)).sort(compareRows);
}
