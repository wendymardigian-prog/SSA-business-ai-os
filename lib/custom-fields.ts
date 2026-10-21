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

// ---------------------------------------------------------------------------
// El valor de un campo, según su tipo
// ---------------------------------------------------------------------------

/**
 * Por qué un valor no sirve para su tipo. Los códigos son los que ya usaba el
 * mapeo de webhooks (y su panel los traduce): no se renombran.
 */
export type CustomValueError =
  | "no_es_un_numero"
  | "no_es_si_no"
  | "fecha_invalida"
  | "url_invalida"
  | "email_invalido";

export type CustomValueResult = { ok: true; value: string } | { ok: false; reason: CustomValueError };

/** El mensaje para una persona, con el nombre del campo. */
export const CUSTOM_VALUE_ERROR_MESSAGES: Record<CustomValueError, string> = {
  no_es_un_numero: "tiene que ser un número",
  no_es_si_no: "tiene que ser Sí o No",
  fecha_invalida: "tiene que ser una fecha (AAAA-MM-DD o DD/MM/AAAA)",
  url_invalida: "tiene que ser una dirección que empiece con http:// o https://",
  email_invalido: "tiene que ser un email",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TRUE_WORDS = ["true", "1", "si", "sí", "yes", "y", "verdadero"];
const FALSE_WORDS = ["false", "0", "no", "n", "falso"];

/** "3,5" y "3.5" son 3.5; con los dos separadores, el último es el decimal. */
function parseNumber(raw: string): number | null {
  let text = raw.replace(/\s/g, "");
  if (text === "") return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // "1.500,5" o "1,500.5": el separador que aparece último es el decimal.
    text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    text = text.replace(",", ".");
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Una fecha civil real, sin pasar por la zona horaria del servidor. */
function civilDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1000 || y > 9999) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDate(raw: string): string | null {
  const text = raw.trim();
  // AAAA-MM-DD, también al principio de una fecha con hora: se toma el día
  // tal como viene escrito, sin convertir de zona.
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(text);
  if (m) return civilDate(Number(m[1]), Number(m[2]), Number(m[3]));
  // DD/MM/AAAA o DD-MM-AAAA (el orden de acá, nunca el de EE. UU.).
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m) return civilDate(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/**
 * La ÚNICA regla de qué valor acepta cada tipo, y en qué forma se guarda.
 * La usan la ficha, el paso de flujo "Definir campo", la importación por CSV y
 * el webhook. Lo que se guarda es siempre texto:
 *   - número: "3.5" (punto decimal, sin miles)
 *   - sí/no: "true" / "false"
 *   - fecha: "AAAA-MM-DD"
 *   - email: en minúsculas
 * Un valor vacío no llega acá: vaciar un campo es borrar su fila.
 */
export function normalizeCustomValue(type: CustomFieldType | string, raw: string): CustomValueResult {
  const text = raw.trim();
  switch (type) {
    case "number": {
      const n = parseNumber(text);
      return n === null ? { ok: false, reason: "no_es_un_numero" } : { ok: true, value: String(n) };
    }
    case "boolean": {
      const t = text.toLowerCase();
      if (TRUE_WORDS.includes(t)) return { ok: true, value: "true" };
      if (FALSE_WORDS.includes(t)) return { ok: true, value: "false" };
      return { ok: false, reason: "no_es_si_no" };
    }
    case "date": {
      const d = parseDate(text);
      return d ? { ok: true, value: d } : { ok: false, reason: "fecha_invalida" };
    }
    case "url":
      return /^https?:\/\/\S+$/i.test(text) ? { ok: true, value: text } : { ok: false, reason: "url_invalida" };
    case "email":
      return EMAIL_RE.test(text) ? { ok: true, value: text.toLowerCase() } : { ok: false, reason: "email_invalido" };
    default:
      return { ok: true, value: text };
  }
}

/** Cómo se muestra un valor guardado: "Sí"/"No" y la fecha en DD/MM/AAAA. */
export function displayCustomValue(type: CustomFieldType | string, value: string | null | undefined): string {
  if (value == null || value === "") return "";
  if (type === "boolean") {
    if (value === "true") return "Sí";
    if (value === "false") return "No";
    return value;
  }
  if (type === "date") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
  }
  return value;
}
