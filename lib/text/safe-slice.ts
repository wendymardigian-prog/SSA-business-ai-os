/**
 * Cortar un texto sin partir un emoji por la mitad. Puro.
 *
 * `text.slice(0, n)` corta por unidades UTF-16: si un emoji (dos unidades,
 * un "par sustituto") queda justo en el borde, sobrevive solo una mitad. Ese
 * texto ya no se puede mandar como JSON: Anthropic devuelve «The request body
 * is not valid JSON: unexpected end of hex escape» y PostgREST «Empty or invalid
 * json». Pasó con el clasificador de mensajes (17 y 18/11/2026: el mismo lote
 * fallaba cada noche).
 *
 * Estas funciones cortan igual que `slice` y, si el borde parte un par, dejan
 * afuera esa mitad suelta (el resultado puede quedar una unidad más corto).
 * Un texto sin emojis en el borde da exactamente lo mismo que `slice`.
 */

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Los primeros `max` caracteres (unidades UTF-16), sin dejar una mitad de emoji al final. */
export function headText(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return isHighSurrogate(cut.charCodeAt(cut.length - 1)) ? cut.slice(0, -1) : cut;
}

/** Los últimos `max` caracteres (unidades UTF-16), sin dejar una mitad de emoji al principio. */
export function tailText(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  return isLowSurrogate(cut.charCodeAt(0)) ? cut.slice(1) : cut;
}
