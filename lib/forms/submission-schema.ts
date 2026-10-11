/**
 * Validación de las respuestas de un envío (F12). La MISMA función corre en el
 * navegador (feedback rápido) y en el servidor (la que manda).
 *
 * Qué hace, en orden:
 *  1. Calcula qué campos se muestran con las respuestas recibidas, ENCADENADO
 *     (F5): lo que no se muestra se DESCARTA aunque venga con valor, y sus
 *     obligatorios no se exigen.
 *  2. Valida y normaliza cada campo visible por su tipo.
 *  3. Descarta toda clave que no sea un campo de la definición.
 *
 * Los archivos no pasan por acá (son bytes, los valida `submit.ts` por su tipo
 * real): solo se le dice cuántos llegó por campo, para el "obligatorio".
 *
 * Nota de diseño: no se arma con Zod porque la visibilidad encadenada hace que
 * el esquema dependa de las propias respuestas; una función que devuelve errores
 * por clave dice mejor QUÉ campo está mal.
 */
import { normalizePhoneWithCountry } from "@/lib/scheduling/phone-countries";
import type { FormField } from "./fields";
import { visibleFieldKeys, type Answers } from "./visibility";

export type NormalizedValue = string | number | boolean | string[];

export interface SubmissionOptions {
  /** País para los teléfonos sin prefijo (de la zona del workspace o del navegador). */
  defaultCountry?: string | null;
  /** Cuántos archivos llegaron por clave de campo. */
  fileCounts?: Record<string, number>;
}

export interface SubmissionResult {
  ok: boolean;
  /** Respuestas válidas y normalizadas de los campos visibles (sin archivos). */
  values: Record<string, NormalizedValue>;
  /** Mensaje por clave de campo. */
  errors: Record<string, string>;
  /** Claves visibles, en orden. */
  visible: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_MAX = 500;
const LONG_TEXT_MAX = 5000;

export const MESSAGES = {
  required: "Completá este campo",
  option: "Elegí una de las opciones",
  options: "Elegí solo opciones de la lista",
  email: "Ingresá un email válido",
  phone: "Ingresá un teléfono válido, con el código de tu país",
  number: "Ingresá un número",
  date: "Ingresá una fecha válida",
  rating: "Elegí de 1 a 5 estrellas",
  nps: "Elegí un número de 0 a 10",
  consent: "Tenés que aceptar para continuar",
  file: "Subí al menos un archivo",
  tooLong: "El texto es demasiado largo",
} as const;

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "on" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return null;
}

function matchOption(options: string[] | undefined, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const wanted = value.trim().toLowerCase();
  return (options ?? []).find((o) => o.trim().toLowerCase() === wanted) ?? null;
}

function validateField(
  field: FormField,
  raw: unknown,
  options: SubmissionOptions,
): { value?: NormalizedValue; error?: string } {
  const blank = isBlank(raw);

  switch (field.type) {
    case "file":
      return (options.fileCounts?.[field.key] ?? 0) === 0 && field.required ? { error: MESSAGES.file } : {};

    case "hidden": {
      if (blank) return {};
      const text = String(raw).trim().slice(0, TEXT_MAX);
      return text ? { value: text } : {};
    }

    case "consent": {
      const bool = toBoolean(raw);
      if (field.required) return bool === true ? { value: true } : { error: MESSAGES.consent };
      return bool === null ? {} : { value: bool };
    }

    case "short_text":
    case "long_text": {
      if (blank) return field.required ? { error: MESSAGES.required } : {};
      if (typeof raw !== "string") return { error: MESSAGES.required };
      const text = raw.trim();
      const max = field.type === "short_text" ? TEXT_MAX : LONG_TEXT_MAX;
      return text.length > max ? { error: MESSAGES.tooLong } : { value: text };
    }

    case "email": {
      if (blank) return field.required ? { error: MESSAGES.required } : {};
      const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      return EMAIL_RE.test(email) && email.length <= 254 ? { value: email } : { error: MESSAGES.email };
    }

    case "phone": {
      if (blank) return field.required ? { error: MESSAGES.required } : {};
      const input =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as { number?: unknown; country?: unknown })
          : typeof raw === "string"
            ? raw
            : null;
      const normalized = normalizePhoneWithCountry(
        input as never,
        options.defaultCountry ?? undefined,
      );
      return normalized ? { value: normalized } : { error: MESSAGES.phone };
    }

    case "number": {
      if (blank) return field.required ? { error: MESSAGES.required } : {};
      const n = toNumber(raw);
      if (n === null) return { error: MESSAGES.number };
      if (field.min !== undefined && n < field.min) return { error: `El mínimo es ${field.min}` };
      if (field.max !== undefined && n > field.max) return { error: `El máximo es ${field.max}` };
      return { value: n };
    }

    case "single_select": {
      if (blank) return field.required ? { error: MESSAGES.option } : {};
      const match = matchOption(field.options, raw);
      return match ? { value: match } : { error: MESSAGES.option };
    }

    case "multi_select": {
      if (blank) return field.required ? { error: MESSAGES.option } : {};
      const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : null;
      if (!list) return { error: MESSAGES.options };
      const resolved: string[] = [];
      for (const item of list) {
        const match = matchOption(field.options, item);
        if (!match) return { error: MESSAGES.options };
        if (!resolved.includes(match)) resolved.push(match);
      }
      return resolved.length > 0 ? { value: resolved } : field.required ? { error: MESSAGES.option } : {};
    }

    case "date": {
      if (blank) return field.required ? { error: MESSAGES.required } : {};
      const text = typeof raw === "string" ? raw.trim() : "";
      if (!ISO_DATE_RE.test(text)) return { error: MESSAGES.date };
      const d = new Date(`${text}T00:00:00Z`);
      return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text ? { error: MESSAGES.date } : { value: text };
    }

    case "rating":
    case "nps": {
      if (blank) return field.required ? { error: field.type === "rating" ? MESSAGES.rating : MESSAGES.nps } : {};
      const n = toNumber(raw);
      const [min, max] = field.type === "rating" ? [1, 5] : [0, 10];
      if (n === null || !Number.isInteger(n) || n < min || n > max) {
        return { error: field.type === "rating" ? MESSAGES.rating : MESSAGES.nps };
      }
      return { value: n };
    }

    default:
      return {};
  }
}

export function validateSubmission(
  fields: FormField[],
  rawAnswers: Record<string, unknown>,
  options: SubmissionOptions = {},
): SubmissionResult {
  const known = new Set(fields.map((f) => f.key));
  // Para decidir la visibilidad solo cuentan las claves conocidas.
  const forVisibility: Answers = {};
  for (const [key, value] of Object.entries(rawAnswers ?? {})) {
    if (known.has(key)) forVisibility[key] = value as Answers[string];
  }

  const visible = visibleFieldKeys(fields, forVisibility);
  const visibleSet = new Set(visible);

  const values: Record<string, NormalizedValue> = {};
  const errors: Record<string, string> = {};

  for (const field of fields) {
    if (!visibleSet.has(field.key)) continue;
    const { value, error } = validateField(field, rawAnswers?.[field.key], options);
    if (error) errors[field.key] = error;
    else if (value !== undefined) values[field.key] = value;
  }

  return { ok: Object.keys(errors).length === 0, values, errors, visible };
}

/** Lo que se guarda en la respuesta: la etiqueta de ESTA versión al lado de cada valor. */
export interface LabeledAnswer {
  label: string;
  type: FormField["type"];
  value: unknown;
}

export function toLabeledAnswers(
  fields: FormField[],
  values: Record<string, unknown>,
): Record<string, LabeledAnswer> {
  const out: Record<string, LabeledAnswer> = {};
  for (const field of fields) {
    if (!(field.key in values)) continue;
    out[field.key] = { label: field.label, type: field.type, value: values[field.key] };
  }
  return out;
}
