/**
 * Avisos entre los modales de generar y la pestaña Generaciones (viven en la misma pantalla, la del editor de la
 * plantilla): al emitir o encolar una tanda, la pestaña vuelve a leer su lista sin esperar a los 5 segundos.
 */

export const GENERATIONS_CHANGED = "designer:generations-changed";

export function notifyGenerationsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(GENERATIONS_CHANGED));
}
