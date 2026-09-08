/**
 * Campos personalizados: tipos y generacion del identificador.
 *
 * El slug no es cosmetico. El flow builder busca los campos por slug
 * (lib/flow-engine/engine.ts) y esos slugs quedan escritos adentro del JSON de
 * los flows, que nada migra. Por eso se genera una vez al crear el campo y no
 * cambia cuando alguien lo renombra: si cambiara, el nodo que lo usa dejaria de
 * encontrarlo y falla en silencio.
 */

import type { CustomFieldType } from "@/lib/types/database";

export const CUSTOM_FIELD_TYPES: CustomFieldType[] = [
  "text",
  "number",
  "boolean",
  "date",
  "url",
  "email",
];

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Texto",
  number: "Numero",
  boolean: "Si / No",
  date: "Fecha",
  url: "URL",
  email: "Email",
};

export function isCustomFieldType(value: unknown): value is CustomFieldType {
  return typeof value === "string" && (CUSTOM_FIELD_TYPES as string[]).includes(value);
}

/** Tope del slug: entra en el nodo de un flow sin ocupar toda la pantalla. */
const MAX_SLUG = 40;

/**
 * El identificador que se genera del nombre: minusculas, sin acentos, y todo
 * lo que no sea letra o numero convertido en guion bajo.
 *
 * Si el nombre no deja nada utilizable (solo emojis, o un alfabeto no latino),
 * devuelve null y el llamador arma uno al azar: es preferible un slug feo a
 * uno vacio, que chocaria con el siguiente campo igual de vacio.
 */
export function slugify(name: string): string | null {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/_+$/, "");

  return slug || null;
}

/**
 * Un slug que no choque con los que ya existen. Si "presupuesto" esta tomado,
 * prueba "presupuesto_2", "presupuesto_3"...
 */
export function uniqueSlug(name: string, taken: Iterable<string>): string {
  const usados = new Set(taken);
  const base = slugify(name) ?? `campo_${Math.random().toString(16).slice(2, 8)}`;

  if (!usados.has(base)) return base;

  for (let n = 2; n < 100; n++) {
    const candidato = `${base.slice(0, MAX_SLUG - 4)}_${n}`;
    if (!usados.has(candidato)) return candidato;
  }

  return `${base.slice(0, MAX_SLUG - 7)}_${Math.random().toString(16).slice(2, 8)}`;
}
