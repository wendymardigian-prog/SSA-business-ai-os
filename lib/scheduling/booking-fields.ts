// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * Formulario de reserva (F20): el tipo de `event_types.booking_fields`, su
 * validación al guardar, y `buildBookingSchema`, que arma el Zod con el que
 * se validan las respuestas del invitado en el booker y en el servidor.
 *
 * Adaptado de `packages/features/form-builder/schema.ts` y
 * `packages/features/bookings/lib/getBookingResponsesSchema.ts`, limitado a
 * los tipos del plano: name, email, phone, short_text, long_text, select y
 * multiselect. Sin variantes de nombre, sin routing, sin precios.
 */
import { z } from "zod";
import type { BookingField, BookingFieldType, BookingFieldVisibility } from "./types";
import { slugify } from "./slug";
import { normalizePhoneWithCountry, DEFAULT_PHONE_COUNTRY, type PhoneInput } from "./phone-countries";

export const BOOKING_FIELD_TYPES: BookingFieldType[] = [
  "name",
  "email",
  "phone",
  "short_text",
  "long_text",
  "select",
  "multiselect",
];

export const CUSTOM_FIELD_TYPES: BookingFieldType[] = ["short_text", "long_text", "select", "multiselect"];

export const FIELD_TYPE_LABELS: Record<BookingFieldType, string> = {
  name: "Nombre",
  email: "Email",
  phone: "Teléfono",
  short_text: "Texto corto",
  long_text: "Texto largo",
  select: "Selección",
  multiselect: "Selección múltiple",
};

export const VISIBILITIES: BookingFieldVisibility[] = ["required", "optional", "hidden"];

/** Los campos del sistema, en su orden fijo. Su `identifier` es fijo. */
export const SYSTEM_FIELD_IDS = ["name", "email", "phone"] as const;

export const IDENTIFIER_RE = /^[a-z][a-z0-9_]{0,39}$/;

export const MAX_OPTIONS = 50;
export const MIN_OPTIONS = 2;
export const SHORT_TEXT_MAX = 500;
export const LONG_TEXT_MAX = 5000;

/** Formulario base con el que nace cada evento (F17). */
export function defaultBookingFields(): BookingField[] {
  return [
    { id: "name", type: "name", system: true, label: "Nombre", placeholder: "Tu nombre", visibility: "required", identifier: "name" },
    { id: "email", type: "email", system: true, label: "Email", placeholder: "tu@email.com", visibility: "required", identifier: "email" },
    { id: "phone", type: "phone", system: true, label: "Teléfono", visibility: "optional", identifier: "phone" },
  ];
}

/** "¿Cuál es tu presupuesto?" → "cual_es_tu_presupuesto". Siempre válido para `IDENTIFIER_RE`. */
export function identifierFromLabel(label: string): string {
  let id = slugify(label).replace(/-/g, "_").replace(/[^a-z0-9_]/g, "");
  if (!id) return "pregunta";
  if (!/^[a-z]/.test(id)) id = `p_${id}`;
  return id.slice(0, 40).replace(/_+$/, "");
}

/** Un identificador que no choque con los existentes: `base`, `base_2`, `base_3`… */
export function uniqueIdentifier(base: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base.slice(0, 40 - String(i).length - 1)}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const optionsSchema = z
  .array(z.string().trim().min(1, "Una opción está vacía").max(100))
  .min(MIN_OPTIONS, `Cargá al menos ${MIN_OPTIONS} opciones`)
  .max(MAX_OPTIONS, `Como máximo ${MAX_OPTIONS} opciones`)
  .refine((opts) => new Set(opts.map((o) => o.toLowerCase())).size === opts.length, "Hay opciones repetidas");

export const bookingFieldSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: z.enum(BOOKING_FIELD_TYPES as [BookingFieldType, ...BookingFieldType[]]),
    system: z.boolean(),
    label: z.string().trim().min(1, "La etiqueta es obligatoria").max(80),
    help: z.string().max(200).optional(),
    placeholder: z.string().max(100).optional(),
    visibility: z.enum(VISIBILITIES as [BookingFieldVisibility, ...BookingFieldVisibility[]]),
    options: optionsSchema.optional(),
    identifier: z.string().regex(IDENTIFIER_RE, "Identificador inválido: minúsculas, números y guión bajo, empieza con letra"),
    contactFieldId: z.string().nullable().optional(),
  })
  .superRefine((f, ctx) => {
    const needsOptions = f.type === "select" || f.type === "multiselect";
    if (needsOptions && !f.options) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Las preguntas de selección necesitan opciones" });
    }
    const isSystemType = f.type === "name" || f.type === "email" || f.type === "phone";
    if (isSystemType !== f.system) {
      ctx.addIssue({ code: "custom", path: ["system"], message: "Los tipos nombre, email y teléfono son del sistema" });
    }
    if (f.system && f.identifier !== f.type) {
      ctx.addIssue({ code: "custom", path: ["identifier"], message: "El identificador de un campo del sistema es fijo" });
    }
    if (f.type === "name" && f.visibility !== "required") {
      ctx.addIssue({ code: "custom", path: ["visibility"], message: "El nombre es siempre obligatorio" });
    }
  });

export const EMAIL_OR_PHONE_REQUIRED = "Email o teléfono tiene que ser obligatorio";

export const bookingFieldsSchema = z.array(bookingFieldSchema).superRefine((fields, ctx) => {
  const byId = new Map<string, number>();
  fields.forEach((f, i) => {
    if (byId.has(f.identifier)) {
      ctx.addIssue({ code: "custom", path: [i, "identifier"], message: `Hay dos preguntas con el identificador "${f.identifier}"` });
    } else byId.set(f.identifier, i);
  });

  for (const id of SYSTEM_FIELD_IDS) {
    if (!fields.some((f) => f.system && f.type === id)) {
      ctx.addIssue({ code: "custom", path: [], message: `Falta el campo del sistema "${id}"` });
    }
  }

  const email = fields.find((f) => f.type === "email");
  const phone = fields.find((f) => f.type === "phone");
  if (email && phone && email.visibility !== "required" && phone.visibility !== "required") {
    ctx.addIssue({ code: "custom", path: [], message: EMAIL_OR_PHONE_REQUIRED });
  }

  // Los del sistema van arriba, en orden fijo.
  const systemPositions = fields.map((f, i) => (f.system ? i : -1)).filter((i) => i >= 0);
  const expected = SYSTEM_FIELD_IDS.map((id) => fields.findIndex((f) => f.system && f.type === id)).filter((i) => i >= 0);
  if (systemPositions.some((p, i) => p !== i) || expected.some((p, i) => p !== i)) {
    ctx.addIssue({ code: "custom", path: [], message: "Los campos del sistema van primero: nombre, email, teléfono" });
  }
});

export type FieldsValidation = { ok: true; fields: BookingField[] } | { ok: false; errors: { path: string; message: string }[] };

export function validateBookingFields(input: unknown): FieldsValidation {
  const parsed = bookingFieldsSchema.safeParse(input);
  if (parsed.success) return { ok: true, fields: parsed.data as BookingField[] };
  return { ok: false, errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

/** Los campos que ve el invitado, en orden. */
export function visibleFields(fields: BookingField[]): BookingField[] {
  return fields.filter((f) => f.visibility !== "hidden");
}

export interface BuildSchemaOptions {
  /** País del selector de teléfono cuando la respuesta viene sin país. */
  defaultCountry?: string | null;
}

const REQUIRED = "Este campo es obligatorio";

function emptyToUndefined(v: unknown): unknown {
  if (v === null) return undefined;
  if (typeof v === "string" && v.trim() === "") return undefined;
  if (Array.isArray(v) && v.length === 0) return undefined;
  return v;
}

function textSchema(max: number, required: boolean) {
  const base = z.string().trim().max(max, `Como máximo ${max} caracteres`);
  return required ? base.min(1, REQUIRED) : base.optional();
}

/**
 * El Zod de las respuestas del invitado para este formulario. Las claves son
 * los `identifier`. Los campos ocultos no se piden ni se validan; las claves
 * desconocidas se descartan.
 *
 * El teléfono acepta un string internacional o `{ country, number }`, y sale
 * siempre normalizado como `+<dígitos>`.
 */
export function buildBookingSchema(fields: BookingField[], options: BuildSchemaOptions = {}) {
  const defaultCountry = options.defaultCountry ?? DEFAULT_PHONE_COUNTRY;
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const f of visibleFields(fields)) {
    const required = f.visibility === "required";
    let schema: z.ZodTypeAny;

    switch (f.type) {
      case "name":
        schema = z.string().trim().min(1, REQUIRED).max(120);
        break;
      case "email": {
        const base = z.string().trim().max(254).pipe(z.email("Email inválido"));
        schema = required ? base : base.optional();
        break;
      }
      case "phone": {
        const base = z
          .union([z.string(), z.object({ country: z.string().nullable().optional(), number: z.string() })])
          .transform((v, ctx) => {
            const normalized = normalizePhoneWithCountry(v as PhoneInput, defaultCountry);
            if (!normalized) {
              ctx.addIssue({ code: "custom", message: "Teléfono inválido: elegí el país y escribí el número completo" });
              return z.NEVER;
            }
            return normalized;
          });
        schema = required ? base : base.optional();
        break;
      }
      case "short_text":
        schema = textSchema(SHORT_TEXT_MAX, required);
        break;
      case "long_text":
        schema = textSchema(LONG_TEXT_MAX, required);
        break;
      case "select": {
        const opts = f.options ?? [];
        const base = z.string().refine((v) => opts.includes(v), "Elegí una de las opciones");
        schema = required ? base : base.optional();
        break;
      }
      case "multiselect": {
        const opts = f.options ?? [];
        const base = z
          .preprocess((v) => (typeof v === "string" ? [v] : v), z.array(z.string()))
          .refine((arr) => arr.every((v) => opts.includes(v)), "Una de las opciones no existe")
          .refine((arr) => new Set(arr).size === arr.length, "Hay opciones repetidas");
        schema = required ? base.refine((arr) => arr.length > 0, REQUIRED) : base.optional();
        break;
      }
    }

    // Un string vacío o null en un campo opcional se lee como "sin respuesta".
    shape[f.identifier] = required ? schema : z.preprocess(emptyToUndefined, schema);
  }

  return z.object(shape);
}

export type BookingResponses = Record<string, string | string[] | undefined>;

/** Nombre, email y teléfono ya validados, para el contacto. */
export function contactDataFromResponses(responses: Record<string, unknown>): { name: string; email: string | null; phone: string | null } {
  return {
    name: typeof responses.name === "string" ? responses.name : "",
    email: typeof responses.email === "string" ? responses.email : null,
    phone: typeof responses.phone === "string" ? responses.phone : null,
  };
}
