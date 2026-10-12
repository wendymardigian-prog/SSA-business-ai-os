/**
 * Del mapeo a lo que la base necesita para crear o vincular el contacto (F16).
 * PURO: lo llama el envío con las respuestas ya validadas y le pasa el resultado
 * a la RPC `submit_form_response` como `p_contact_hint`.
 */
import { resolveCountry } from "@/lib/contacts/country";
import { normalizeSocialHandle, SOCIAL_LOOKUP_PLATFORMS, type SocialPlatform } from "@/lib/contacts/social";
import type { ContactNote } from "./contact-outcome";
import { CUSTOM_PREFIX, customSlugOf, isCustomTarget, socialPlatformOf, type ContactConfig, type CustomFieldDef } from "./contact-config";
import type { FormField } from "./fields";

export interface ContactHint {
  display_name?: string;
  email?: string;
  phone?: string;
  whatsapp_phone?: string;
  country?: string;
  /** Usuarios de redes sociales, YA normalizados (`ana`, no `@Ana`; LinkedIn como URL del perfil). */
  social?: Partial<Record<SocialPlatform, string>>;
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
  return applyContactMappingDetailed(fields, config, values, customFields).hint;
}

/**
 * Lo mismo, y además lo que NO se pudo guardar en el contacto (un país o un usuario que no se reconoce). La
 * respuesta se guarda igual; las notas se ven en su detalle (`meta.contact_notes`).
 */
export function applyContactMappingDetailed(
  fields: FormField[],
  config: ContactConfig,
  values: Record<string, unknown>,
  customFields: CustomFieldDef[],
): { hint: ContactHint; notes: ContactNote[] } {
  const hint: ContactHint = { custom: {} };
  const notes: ContactNote[] = [];
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
      case "contact.country": {
        // El código ("CR") o el nombre en español o inglés ("Costa Rica", "Spain").
        const country = resolveCountry(text);
        if (country) hint.country = country;
        else notes.push({ reason: "country_unrecognized", text });
        break;
      }
      default: {
        const platform = socialPlatformOf(entry.target);
        if (platform) {
          // Un texto que no es un usuario válido no se guarda en el contacto; la respuesta queda igual.
          const handle = normalizeSocialHandle(platform, text);
          if (handle.ok) hint.social = { ...hint.social, [platform]: handle.value };
          else notes.push({ reason: "social_invalid", text, platform });
          break;
        }
        if (isCustomTarget(entry.target)) {
          const def = customFields.find((c) => `${CUSTOM_PREFIX}${c.slug}` === entry.target || c.slug === customSlugOf(entry.target));
          // Un campo personalizado borrado se ignora: no hace fallar el envío.
          if (def) hint.custom[def.id] = text;
        }
      }
    }
  }

  if (!hint.display_name && (first || last)) hint.display_name = [first, last].filter(Boolean).join(" ");
  return { hint, notes };
}

/**
 * ¿La respuesta tiene con qué crear o vincular un contacto? Email, teléfono, WhatsApp o un usuario de
 * Instagram, TikTok, X o LinkedIn. Facebook y YouTube solo se guardan: no sirven para identificar.
 */
export function canResolveContact(hint: ContactHint): boolean {
  if (hint.email || hint.phone || hint.whatsapp_phone) return true;
  return SOCIAL_LOOKUP_PLATFORMS.some((platform) => !!hint.social?.[platform]);
}
