/**
 * El respaldo de una variable en un flujo: `{{contact.first_name|hola}}` o `{{contact.first_name | "hola"}}`. PURO: lo
 * usan el motor, el email y el simulador.
 *
 * Sin `|`, un token que no resuelve sigue quedando literal, como siempre. Con `|`, la persona recibe el respaldo: un
 * valor vacío o un nombre de relleno («@usuario», un id) no es un nombre con el que saludar a nadie.
 */
import { isPlaceholderName } from "@/lib/contacts/anonymous";

const NAME_PATHS = new Set(["contact.first_name", "contact.name", "contact.display_name"]);

export function needsFallback(path: string, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  return !value.trim() || (NAME_PATHS.has(path) && isPlaceholderName(value));
}

/** El texto del respaldo, sin los espacios ni las comillas con que se escribió. */
export function fallbackText(raw: string): string {
  const text = raw.trim();
  const quoted = /^(?:"([\s\S]*)"|'([\s\S]*)'|“([\s\S]*)”|&quot;([\s\S]*)&quot;)$/.exec(text);
  return quoted ? (quoted[1] ?? quoted[2] ?? quoted[3] ?? quoted[4] ?? "") : text;
}
