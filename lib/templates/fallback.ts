/**
 * El respaldo de una variable en un flujo: `{{contact.first_name|hola}}` o `{{contact.first_name | "hola"}}`. PURO: lo
 * usan el motor, el email y el simulador.
 *
 * Sin `|`, un token que no resuelve sigue quedando literal, como siempre. Con `|`, la persona recibe el respaldo: un
 * valor vacío o un nombre de relleno («@usuario», un id, «Contacto de WhatsApp») no es un nombre con el que saludar a
 * nadie. Sin `|`, un NOMBRE vacío o de relleno se saca y el saludo queda sin nombre («¡Hola!»), ver `tidyEmptyNames`.
 */
import { isGreetingPlaceholder } from "@/lib/contacts/anonymous";

export const NAME_PATHS: ReadonlySet<string> = new Set(["contact.first_name", "contact.name", "contact.display_name"]);

/**
 * Marca interna para un NOMBRE que quedó vacío sin respaldo (`{{contact.first_name}}` de alguien sin nombre de verdad).
 * `tidyEmptyNames` la saca y acomoda la puntuación de alrededor: «¡Hola !» → «¡Hola!», «Hola, .» → «Hola.». Solo se
 * usa con las variables de nombre: un link o un JSON nunca la reciben.
 */
export const EMPTY_NAME_MARK = "\uE000";

/** true si el valor de una variable de nombre no sirve para saludar (vacío, un relleno o el nombre que puso el sistema). */
export function isEmptyName(path: string, value: unknown): boolean {
  if (!NAME_PATHS.has(path) || typeof value !== "string") return false;
  return !value.trim() || isGreetingPlaceholder(value);
}

/** Saca la marca de los nombres vacíos y acomoda la puntuación y los espacios que quedaron alrededor. */
export function tidyEmptyNames(text: string): string {
  if (!text.includes(EMPTY_NAME_MARK)) return text;
  return text
    .replace(/\uE000(?:[ \t]*\uE000)+/g, EMPTY_NAME_MARK)
    .replace(/,[ \t]*\uE000(?=[ \t]*[!?.…])/g, "")
    .replace(/[ \t]*\uE000(?=[!?.…,;:)]|\n|$)/g, "")
    .replace(/[ \t]+\uE000[ \t]+/g, " ")
    .replace(/\uE000/g, "");
}

export function needsFallback(path: string, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  return !value.trim() || (NAME_PATHS.has(path) && isGreetingPlaceholder(value));
}

/** El texto del respaldo, sin los espacios ni las comillas con que se escribió. */
export function fallbackText(raw: string): string {
  const text = raw.trim();
  const quoted = /^(?:"([\s\S]*)"|'([\s\S]*)'|“([\s\S]*)”|&quot;([\s\S]*)&quot;)$/.exec(text);
  return quoted ? (quoted[1] ?? quoted[2] ?? quoted[3] ?? quoted[4] ?? "") : text;
}
