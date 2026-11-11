/**
 * Columnas fijas a la izquierda: cuáles son y dónde empieza cada una. PURO (extraído de la tabla «Meta vs CRM»).
 * Las fijas se dibujan primero y quedan pegadas al desplazar la tabla de costado; las offsets salen de los anchos medidos.
 */

/** Las columnas a la vista partidas en fijas (en el orden en que se fijaron, solo las que se ven) y el resto (en su orden). */
export function splitPinned<T extends { key: string }>(columns: readonly T[], pinned: readonly string[]): { pinned: T[]; rest: T[] } {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const fixed = pinned.map((key) => byKey.get(key)).filter((c): c is T => !!c);
  const fixedKeys = new Set(fixed.map((c) => c.key));
  return { pinned: fixed, rest: columns.filter((c) => !fixedKeys.has(c.key)) };
}

/** Donde empieza cada columna fija, a partir de los anchos de las anteriores (en px). */
export function stickyOffsets(widths: readonly number[], start = 0): number[] {
  const out: number[] = [];
  let left = start;
  for (const width of widths) {
    out.push(left);
    left += width;
  }
  return out;
}
