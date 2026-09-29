/**
 * La escala del eje de un grafico: el escalon "lindo" y el tope.
 *
 * Vive aca y no en el componente para poder probarla: un eje que elige 3,33 por
 * escalon es ilegible, y es el tipo de cosa que se rompe sin que nadie lo note.
 */

/** El escalon del eje: 1, 2, 5 o 10 por decada, apuntando a unas 4 lineas. */
export function niceStep(max: number): number {
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

/** El tope del eje: el primer multiplo del escalon que cubre el maximo. */
export function axisTop(max: number, step: number): number {
  if (step <= 0) return Math.max(1, max);
  return Math.ceil(Math.max(max, 0) / step) * step;
}

/** Los valores donde van las lineas de la grilla, del 0 al tope. */
export function axisTicks(top: number, step: number): number[] {
  if (step <= 0) return [0, top];
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/**
 * Cada cuantas columnas se escribe una fecha en el eje. Con 90 dias no entran
 * las 90 etiquetas, y superpuestas no se lee ninguna.
 */
export function labelEvery(columns: number, maxLabels = 9): number {
  return Math.max(1, Math.ceil(columns / maxLabels));
}
