/**
 * Del mapeo a lo que la base necesita para crear o vincular el contacto (F16).
 * PURO: lo llama el envío con las respuestas ya validadas y le pasa el resultado
 * a la RPC `submit_form_response` como `p_contact_hint`.
 */
import { CUSTOM_PREFIX, customSlugOf, isCustomTarget, type ContactConfig, type CustomFieldDef } from "./contact-config";
import type { FormField } from "./fields";

export interface ContactHint {
  display_name?: string;
  email?: string;
  phone?: string;
  whatsapp_phone?: string;
  country?: string;
  /** `custom_field_definitions.id` → valor en texto. */
  custom: Record<string, string>;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

export function applyContactMapping(
  fields: FormField[],
  config: ContactConfig,
  values: Record<string, unknown>,
  customFields: CustomFieldDef[],
): ContactHint {
  const hint: ContactHint = { custom: {} };
  let first = "";
  let last = "";

  for (const entry of config.map) {
    const field = fields.find((f) => f.key === entry.fieldKey);
    if (!field) continue; // el campo se borró del formulario: el mapeo se ignora
    const text = asText(values[entry.fieldKey]);
    if (text === "") continue;

    switch (entry.target) {
      case "contact.display_name":
        hint.display_name = text;
        break;
      case "contact.first_name_part":
        first = text;
        break;
      case "contact.last_name_part":
        last = text;
        break;
      case "contact.email":
        hint.email = text.toLowerCase();
        break;
      case "contact.phone":
        hint.phone = text;
        break;
      case "contact.whatsapp_phone":
        hint.whatsapp_phone = text;
        break;
      case "contact.country":
        if (/^[A-Za-z]{2}$/.test(text)) hint.country = text.toUpperCase();
        break;
      default:
        if (isCustomTarget(entry.target)) {
          const def = customFields.find((c) => `${CUSTOM_PREFIX}${c.slug}` === entry.target || c.slug === customSlugOf(entry.target));
          // Un campo personalizado borrado se ignora: no hace fallar el envío.
          if (def) hint.custom[def.id] = text;
        }
    }
  }

  if (!hint.display_name && (first || last)) hint.display_name = [first, last].filter(Boolean).join(" ");
  return hint;
}

/** ¿La respuesta tiene con qué crear o vincular un contacto? */
export function canResolveContact(hint: ContactHint): boolean {
  return !!(hint.email || hint.phone || hint.whatsapp_phone);
}
