/**
 * El tooltip en una pantalla tactil (24/11/2026): no hay «hover», asi que se abre al MANTENER el dedo. Un toque corto
 * hace lo de siempre (abrir, apretar). Puro: los tiempos y la regla de cuando un toque deja de ser «mantener».
 */

/** Cuanto hay que mantener el dedo para que se abra. */
export const TOUCH_HOLD_MS = 500;
/** Cuanto queda abierto despues de soltar (en el telefono no hay «salir con el mouse»). */
export const TOUCH_OPEN_MS = 3000;
/** Si el dedo se mueve mas que esto, es un desplazamiento y no un «mantener». */
export const TOUCH_MOVE_TOLERANCE_PX = 10;

/** Si el dedo se movio lo suficiente como para que ya no cuente como mantener. */
export function touchMovedTooFar(start: { x: number; y: number }, now: { x: number; y: number }): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) > TOUCH_MOVE_TOLERANCE_PX;
}
