/**
 * Validación de la definición de un formulario (F4).
 *
 * Dos capas: Zod para la FORMA de cada campo y reglas cruzadas a mano (claves
 * únicas, condiciones solo sobre campos anteriores, parámetros de prellenado sin
 * repetir) para poder decir QUÉ campo está mal, con su clave o su etiqueta.
 *
 * La usan el editor (al guardar y al publicar) y el servidor (al publicar).
 */
import { z } from "zod";
import { IDENTIFIER_RE } from "@/lib/scheduling/identifier";
import { ATTRIBUTION_KEYS } from "@/lib/attribution/keys";
import {
  ALLOWED_UPLOAD_MIMES,
  FILE_LIMITS,
  FORM_FIELD_TYPES,
  MAX_FIELDS,
  MAX_OPTIONS,
  MAX_PREFILL_PARAMS,
  MIN_OPTIONS,
  PREFILL_PARAM_RE,
  supportsPrefill,
  type FormDefinition,
  type FormField,
} from "./fields";
import { SOCIAL_PLATFORMS } from "@/lib/contacts/social";
import { CONDITION_OPERATORS } from "./visibility-types";
import { referencedKeys } from "./visibility";

export const MAX_CONTRACT_TEXT = 60_000;

const conditionSchema = z.object({
  id: z.string().max(64).optional(),
  fieldKey: z.string().min(1).max(40),
  operator: z.enum(CONDITION_OPERATORS),
  value: z.string().max(500).default(""),
});

const visibilitySchema = z.object({
  rootConjunction: z.enum(["and", "or"]),
  conditions: z.array(conditionSchema).max(30),
  groups: z
    .array(
      z.object({
        id: z.string().max(64).optional(),
        conjunction: z.enum(["and", "or"]),
        conditions: z.array(conditionSchema).max(30),
      }),
    )
    .max(10),
});

const fieldSchema = z.object({
  id: z.string().min(1).max(64),
  key: z.string(),
  type: z.enum(FORM_FIELD_TYPES),
  label: z.string().trim().min(1, "Falta la etiqueta").max(200),
  help: z.string().max(500).optional(),
  placeholder: z.string().max(200).optional(),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  file: z
    .object({
      accept: z.array(z.string()),
      maxMb: z.number().finite(),
      maxFiles: z.number().int(),
    })
    .optional(),
  consentText: z.string().max(500).optional(),
  hidden: z
    .object({
      source: z.enum(["url_param", "fixed", "attribution"]),
      param: z.string().max(60).optional(),
      value: z.string().max(500).optional(),
    })
    .optional(),
  visibility: visibilitySchema.optional(),
  prefill: z
    .object({
      params: z.array(z.string()),
      behavior: z.enum(["editable", "locked", "hidden"]),
    })
    .optional(),
  social: z.object({ platform: z.enum(SOCIAL_PLATFORMS) }).optional(),
});

const definitionSchema = z.object({
  fields: z.array(fieldSchema),
  contractText: z.string().max(MAX_CONTRACT_TEXT, "El texto del contrato es demasiado largo").optional(),
});

export type DefinitionResult =
  | { ok: true; definition: FormDefinition }
  | { ok: false; errors: string[] };

function name(field: Pick<FormField, "key" | "label">): string {
  return `"${field.label || field.key}"`;
}

/** Reglas de un solo campo (las que dependen de su tipo). */
function checkField(field: FormField, errors: string[]): void {
  const who = name(field);

  if (!IDENTIFIER_RE.test(field.key)) {
    errors.push(`${who}: la clave "${field.key}" no es válida (minúsculas, números y guión bajo, empezando con letra)`);
  }

  if (field.type === "single_select" || field.type === "multi_select") {
    const options = field.options ?? [];
    const cleaned = options.map((o) => o.trim());
    if (cleaned.some((o) => o === "")) errors.push(`${who}: hay una opción vacía`);
    if (cleaned.some((o) => o.length > 100)) errors.push(`${who}: una opción supera los 100 caracteres`);
    if (cleaned.length < MIN_OPTIONS) errors.push(`${who}: cargá al menos ${MIN_OPTIONS} opciones`);
    if (cleaned.length > MAX_OPTIONS) errors.push(`${who}: como máximo ${MAX_OPTIONS} opciones`);
    if (new Set(cleaned.map((o) => o.toLowerCase())).size !== cleaned.length) {
      errors.push(`${who}: hay opciones repetidas`);
    }
  } else if (field.options && field.options.length > 0) {
    errors.push(`${who}: este tipo de campo no tiene opciones`);
  }

  if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
    errors.push(`${who}: el mínimo no puede ser mayor que el máximo`);
  }
  if (field.type === "rating" && (field.min !== 1 || field.max !== 5)) {
    errors.push(`${who}: las estrellas van de 1 a 5`);
  }
  if (field.type === "nps" && (field.min !== 0 || field.max !== 10)) {
    errors.push(`${who}: el NPS va de 0 a 10`);
  }

  if (field.type === "file") {
    const file = field.file;
    if (!file) {
      errors.push(`${who}: falta la configuración del archivo`);
    } else {
      if (file.maxMb <= 0 || file.maxMb > FILE_LIMITS.maxMb) {
        errors.push(`${who}: el archivo puede pesar hasta ${FILE_LIMITS.maxMb} MB`);
      }
      if (file.maxFiles < 1 || file.maxFiles > FILE_LIMITS.maxFiles) {
        errors.push(`${who}: se aceptan de 1 a ${FILE_LIMITS.maxFiles} archivos`);
      }
      if (file.accept.length === 0) errors.push(`${who}: elegí qué tipos de archivo se aceptan`);
      const allowed = new Set<string>(ALLOWED_UPLOAD_MIMES);
      for (const mime of file.accept) {
        if (!allowed.has(mime)) errors.push(`${who}: el tipo de archivo "${mime}" no está permitido`);
      }
    }
  }

  if (field.type === "social") {
    if (!field.social) errors.push(`${who}: elegí de qué red es el usuario`);
  } else if (field.social) {
    errors.push(`${who}: solo un campo de usuario de red social lleva red`);
  }

  if (field.type === "consent" && !field.consentText?.trim()) {
    errors.push(`${who}: falta el texto del consentimiento`);
  }

  if (field.type === "hidden") {
    const hidden = field.hidden;
    if (!hidden) {
      errors.push(`${who}: falta de dónde sale el valor del campo oculto`);
    } else if (hidden.source === "url_param") {
      if (!hidden.param || !PREFILL_PARAM_RE.test(hidden.param)) {
        errors.push(`${who}: falta el parámetro de la URL (letras, números, punto, guión o guión bajo)`);
      }
    } else if (hidden.source === "attribution") {
      if (!hidden.param || !ATTRIBUTION_KEYS.includes(hidden.param)) {
        errors.push(`${who}: elegí un dato de atribución válido`);
      }
    } else if (hidden.source === "fixed") {
      if (!hidden.value?.trim()) errors.push(`${who}: falta el valor fijo`);
    }
    if (field.required) errors.push(`${who}: un campo oculto no puede ser obligatorio`);
  }

  if (field.prefill) {
    if (!supportsPrefill(field.type)) {
      errors.push(`${who}: este tipo de campo no se puede prellenar desde la URL`);
    } else if (field.type === "hidden") {
      errors.push(`${who}: un campo oculto ya toma su valor de la URL; no lleva prellenado`);
    } else {
      if (field.prefill.params.length === 0) errors.push(`${who}: el prellenado necesita al menos un parámetro`);
      if (field.prefill.params.length > MAX_PREFILL_PARAMS) {
        errors.push(`${who}: como máximo ${MAX_PREFILL_PARAMS} parámetros de prellenado`);
      }
      for (const param of field.prefill.params) {
        if (!PREFILL_PARAM_RE.test(param)) errors.push(`${who}: el parámetro "${param}" no es válido`);
      }
    }
  }
}

/** Valida la forma y las reglas cruzadas. No lanza. */
export function validateDefinition(input: unknown): DefinitionResult {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
      const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
      return `${where}${issue.message}`;
    });
    return { ok: false, errors };
  }

  const definition = parsed.data as FormDefinition;
  const errors: string[] = [];
  const { fields } = definition;

  if (fields.length > MAX_FIELDS) errors.push(`Como máximo ${MAX_FIELDS} campos`);

  // Claves únicas
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.key)) errors.push(`La clave "${field.key}" está repetida`);
    seen.add(field.key);
  }

  // Parámetros de prellenado: no se repiten entre campos
  const paramOwner = new Map<string, string>();
  for (const field of fields) {
    for (const param of field.prefill?.params ?? []) {
      const owner = paramOwner.get(param.toLowerCase());
      if (owner && owner !== field.key) {
        errors.push(`${name(field)}: el parámetro "${param}" ya lo usa ${name(fields.find((f) => f.key === owner)!)}`);
      }
      paramOwner.set(param.toLowerCase(), field.key);
    }
  }

  fields.forEach((field, index) => {
    checkField(field, errors);

    // Una condición solo puede mirar campos anteriores
    const previous = new Set(fields.slice(0, index).map((f) => f.key));
    for (const ref of referencedKeys(field.visibility)) {
      if (!previous.has(ref)) {
        errors.push(`${name(field)}: una condición solo puede mirar preguntas anteriores`);
        break;
      }
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, definition };
}

// ── Borrador: se guarda aunque esté incompleto ───────────────────────────────

const draftFieldShape = z
  .object({
    id: z.string().min(1).max(64),
    key: z.string().max(60),
    type: z.enum(FORM_FIELD_TYPES),
    label: z.string().max(200),
  })
  .passthrough();

const draftShape = z.object({
  fields: z.array(draftFieldShape).max(MAX_FIELDS),
  contractText: z.string().max(MAX_CONTRACT_TEXT).optional(),
});

/**
 * Un borrador se puede guardar con campos a medio hacer (sin etiqueta, con una
 * sola opción): solo se exige que tenga FORMA de definición. Las reglas completas
 * (`validateDefinition`) se exigen al publicar.
 */
export function validateDraftShape(input: unknown): DefinitionResult {
  const parsed = draftShape.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "definición"}: ${i.message}`) };
  }
  return { ok: true, definition: parsed.data as unknown as FormDefinition };
}
