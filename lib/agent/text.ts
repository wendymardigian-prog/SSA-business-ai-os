/**
 * Comparacion de texto para los guardarrailes: minusculas, sin acentos, y
 * frases como palabras completas.
 *
 * "reclamo" tiene que encontrar "Tengo un RECLAMO", pero "legal" no puede
 * encontrar "legalmente habilitado" si la lista dice "legal" como palabra, ni
 * "descuento" puede saltar en "descuentoslocos.com". Por eso no alcanza con
 * includes(): se buscan limites de palabra sobre el texto normalizado.
 */

export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** La primera frase de la lista que aparece como palabras completas, o null. */
export function findPhrase(text: string, phrases: readonly string[]): string | null {
  const haystack = normalizeText(text);
  if (!haystack) return null;
  for (const phrase of phrases) {
    const needle = normalizeText(phrase);
    if (!needle) continue;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}($|[^\\p{L}\\p{N}])`, "u");
    if (pattern.test(haystack)) return phrase;
  }
  return null;
}
