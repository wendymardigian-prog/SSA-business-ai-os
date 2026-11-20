/**
 * Cuántos chips entran en una línea de `available` píxeles. PURO: lo usa `TagChipsFit` (las etiquetas de la tabla de
 * Contactos) con los anchos medidos en el navegador.
 *
 * - Si entran todos, todos (sin «+N»).
 * - Si no, los que entran dejando lugar para el globito «+N» (`plusWidth`).
 * - Al menos uno si hay lugar para algo: una sola etiqueta más ancha que la columna se muestra cortada con «…» antes
 *   que un «+1» solo. Si la columna no deja lugar ni para el «+N» con un chip, 0 (solo el «+N»).
 */
export function fitCount(chipWidths: readonly number[], available: number, gap: number, plusWidth: number): number {
  const n = chipWidths.length;
  if (n === 0) return 0;
  const widthOf = (count: number) => chipWidths.slice(0, count).reduce((sum, w) => sum + w, 0) + gap * Math.max(0, count - 1);
  if (widthOf(n) <= available) return n;
  let count = 0;
  while (count < n - 1 && widthOf(count + 1) + gap + plusWidth <= available) count += 1;
  if (count === 0 && available > plusWidth + gap) return 1;
  return count;
}
