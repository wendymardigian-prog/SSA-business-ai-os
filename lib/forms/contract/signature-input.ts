/**
 * Lo que decide el lienzo de la firma, sin React (F25). PURO.
 *
 * Un TRAZO es una secuencia de puntos entre "apoyar" y "levantar". Solo cuentan los
 * que tienen al menos 2 puntos (un toque suelto no es una firma): esa cuenta viaja
 * como `signature_strokes` y el servidor la vuelve a exigir.
 */

export interface Point {
  x: number;
  y: number;
}

export type Stroke = Point[];

/** Cuántos trazos tienen al menos dos puntos. */
export function countStrokes(strokes: Stroke[]): number {
  return strokes.filter((stroke) => stroke.length >= 2).length;
}

/** ¿Hay algo dibujado de verdad? (para habilitar el botón y mostrar "Borrar") */
export function hasSignature(strokes: Stroke[]): boolean {
  return countStrokes(strokes) >= 1;
}

/**
 * ¿Se puede enviar el contrato? La casilla es obligatoria SIEMPRE; la firma, si el
 * contrato la pide.
 */
export function canSign(input: { accepted: boolean; signatureRequired: boolean; drawn: boolean }): boolean {
  if (!input.accepted) return false;
  return input.signatureRequired ? input.drawn : true;
}

/** Los puntos del puntero en coordenadas del lienzo (que puede estar escalado por CSS). */
export function toCanvasPoint(
  client: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
  canvas: { width: number; height: number },
): Point {
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
  return { x: (client.x - rect.left) * scaleX, y: (client.y - rect.top) * scaleY };
}
