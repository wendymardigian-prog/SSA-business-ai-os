/**
 * Lo que la página pública puede ver de un formulario (F9).
 *
 * `toPublicField` ESPEJA la lista blanca de la función SQL `get_public_form`
 * (00152). La base es la que manda; esto existe para tipar la respuesta, para
 * testear la lista y para que `verify-forms` pueda comprobar que ambas dicen lo
 * mismo.
 *
 * Nunca sale: el id ni el workspace del formulario, el mapeo a contacto, las
 * etiquetas, los avisos, el borrador, la pantalla de éxito ni el valor de un
 * campo oculto de tipo `fixed`.
 */
import type { FormField, PrefillConfig } from "./fields";
import type { VisibilityConfig } from "./visibility-types";

export const PUBLIC_FIELD_KEYS = [
  "key",
  "type",
  "label",
  "help",
  "placeholder",
  "required",
  "options",
  "min",
  "max",
  "file",
  "consentText",
  "visibility",
  "prefill",
  "social",
] as const;

/** Claves que NO pueden aparecer en ningún lugar de la definición pública. */
export const FORBIDDEN_PUBLIC_KEYS = [
  "workspace_id",
  "contact_config",
  "tags_on_submit",
  "notify_enabled",
  "notify_user_ids",
  "draft_definition",
  "success",
  "created_by",
  "updated_by",
  "current_version_id",
  "survey_config",
  "contract_config",
] as const;

export interface PublicField {
  key: string;
  type: FormField["type"];
  label?: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  file?: FormField["file"];
  consentText?: string;
  visibility?: VisibilityConfig;
  prefill?: PrefillConfig;
  social?: FormField["social"];
  /** Solo en ocultos: de dónde sale el valor. */
  hidden?: { source: "url_param" | "attribution"; param?: string };
}

/** El campo como lo ve la página, o null si no se muestra nunca (oculto `fixed`). */
export function toPublicField(field: FormField): PublicField | null {
  if (field.type === "hidden") {
    const hidden = field.hidden;
    if (!hidden || hidden.source === "fixed") return null;
    return { key: field.key, type: "hidden", hidden: { source: hidden.source, param: hidden.param } };
  }

  const out: PublicField = { key: field.key, type: field.type };
  if (field.label !== undefined) out.label = field.label;
  if (field.help !== undefined) out.help = field.help;
  if (field.placeholder !== undefined) out.placeholder = field.placeholder;
  out.required = field.required;
  if (field.options !== undefined) out.options = field.options;
  if (field.min !== undefined) out.min = field.min;
  if (field.max !== undefined) out.max = field.max;
  if (field.file !== undefined) out.file = field.file;
  if (field.consentText !== undefined) out.consentText = field.consentText;
  if (field.visibility !== undefined) out.visibility = field.visibility;
  if (field.prefill !== undefined) out.prefill = field.prefill;
  if (field.social !== undefined) out.social = field.social;
  return out;
}

export function toPublicFields(fields: FormField[]): PublicField[] {
  return fields.map(toPublicField).filter((f): f is PublicField => f !== null);
}

/** Recorre un JSON entero y devuelve las claves prohibidas que encuentre (para los tests de `verify-forms`). */
export function findForbiddenKeys(value: unknown, path = ""): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => found.push(...findForbiddenKeys(v, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if ((FORBIDDEN_PUBLIC_KEYS as readonly string[]).includes(key)) found.push(`${path}.${key}`);
      found.push(...findForbiddenKeys(entry, `${path}.${key}`));
    }
  }
  return found;
}

/** ¿Aparece este texto (por ejemplo el valor de un oculto fijo) en algún lugar del JSON? */
export function containsText(value: unknown, text: string): boolean {
  return JSON.stringify(value).includes(text);
}
