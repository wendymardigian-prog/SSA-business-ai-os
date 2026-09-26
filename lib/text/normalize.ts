/**
 * Normaliza un texto para AGRUPAR mensajes por lo que significan (F4).
 *
 * Espejo EXACTO de la función SQL `public.normalize_for_grouping` (migración
 * 00076). Los dos lados tienen que dar lo mismo: la base la usa para
 * `messages.text_norm` y el clasificador; el evaluador de reglas y la UI usan
 * esta. `lib/text/normalize.test.ts` compara ambas sobre los mismos casos.
 *
 * Pasos: minúsculas → saca acentos (translate, no NFD, para calzar con SQL) →
 * elimina todo lo que no sea letra, número o espacio → colapsa 2+ caracteres
 * iguales seguidos en uno ("siii" → "si") → colapsa espacios y recorta →
 * trunca a 300.
 *
 * Ojo: es distinta de la normalización de "no contactar" (`normalize_message_text`,
 * 00027), que NO colapsa letras repetidas. Esta agrupa; aquella detecta frases.
 */

// Mismo par que el translate() de la función SQL. El orden importa: cada
// carácter de FROM mapea al de TO en la misma posición.
const ACCENTS_FROM = "áàäâãéèëêíìïîóòöôõúùüûñç";
const ACCENTS_TO = "aaaaaeeeeiiiiooooouuuunc";

function translateAccents(input: string): string {
  let out = "";
  for (const ch of input) {
    const idx = ACCENTS_FROM.indexOf(ch);
    out += idx >= 0 ? ACCENTS_TO[idx] : ch;
  }
  return out;
}

export function normalizeForGrouping(raw: string | null | undefined): string {
  const lowered = (raw ?? "").toLowerCase();
  const translated = translateAccents(lowered);
  // Saca todo lo que no sea letra a-z, número o espacio (no lo pasa a espacio:
  // lo elimina, igual que el regexp_replace de SQL).
  const stripped = translated.replace(/[^a-z0-9 ]/g, "");
  // Colapsa 2+ caracteres iguales consecutivos en uno.
  const collapsedDoubles = stripped.replace(/(.)\1+/g, "$1");
  // Colapsa espacios y recorta.
  const collapsedSpaces = collapsedDoubles.replace(/\s+/g, " ").trim();
  return collapsedSpaces.slice(0, 300);
}

/**
 * Los 20 casos que fijan el contrato de la normalización. `verify-dashboards.mjs`
 * los corre también contra la función SQL por RPC y exige igualdad exacta.
 */
export const NORMALIZE_GROUPING_CASES: Array<{ input: string; expected: string }> = [
  { input: "Sí!!", expected: "si" },
  { input: "siii", expected: "si" },
  { input: "SI", expected: "si" },
  { input: "sí", expected: "si" },
  { input: "❤", expected: "" },
  { input: "Siii quiero a clase", expected: "si quiero a clase" },
  { input: "si enviamelo", expected: "si enviamelo" },
  { input: "Si Envíamelo!!!", expected: "si enviamelo" },
  { input: "  hola   mundo  ", expected: "hola mundo" },
  { input: "GRACIAS", expected: "gracias" },
  { input: "graciasss", expected: "gracias" },
  { input: "¿Cuánto sale?", expected: "cuanto sale" },
  { input: "Tengo un negocio", expected: "tengo un negocio" },
  { input: "", expected: "" },
  { input: "   ", expected: "" },
  { input: "😀😀 hola", expected: "hola" },
  { input: "a...b", expected: "ab" },
  { input: "Automatizar TODO", expected: "automatizar todo" },
  { input: "quiero    aprender", expected: "quiero aprender" },
  { input: "Ñoño", expected: "nono" },
];
