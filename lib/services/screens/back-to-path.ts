// @plantilla-quitar(servicios)
/**
 * «Volver al camino» (F117): el editor de Automatizaciones recibe `?volver=` desde el camino de una variante. Solo se
 * acepta una ruta interna de Ajustes › Productos › variante (nunca otra dirección: sería un link abierto).
 */
const PATH = /^\/dashboard\/settings\/productos\/[0-9a-f-]{36}\/variantes\/[0-9a-f-]{36}(\?[A-Za-z0-9=&_%-]*)?$/i;

export function backToPathHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length > 300) return null;
  return PATH.test(raw) ? raw : null;
}
