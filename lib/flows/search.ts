/**
 * Buscar por palabras, sin tildes ni mayusculas (la paleta de pasos y la lista de automatizaciones). Puro.
 * Todas las palabras de la busqueda tienen que aparecer en alguno de los textos.
 */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function matchesQuery(texts: Array<string | null | undefined>, query: string): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldText(texts.filter(Boolean).join(" "));
  return words.every((w) => haystack.includes(w));
}
