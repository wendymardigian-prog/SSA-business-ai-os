/**
 * Campos editables del contacto: como se llaman, como se normalizan y cuando
 * son invalidos.
 *
 * Vive aca y no dentro del Server Action porque es logica pura: la usa el
 * formulario para avisar mientras el usuario escribe, y la vuelve a usar el
 * servidor como barrera real. Mismo patron que lib/integrations/providers.ts.
 *
 * La normalizacion no es cosmetica: el telefono y los usernames son las claves
 * de la deduplicacion cross-canal (migracion 00025), asi que "+54 9 11 2233"
 * y "5491122 33" tienen que terminar guardados igual, y "@Juan" igual que
 * "juan". Si no, el mismo lead entra dos veces.
 */

import { normalizePhone } from "@/lib/phone";
import { datetimeInputToIso } from "@/lib/dates";
import type { LeadTemperature } from "@/lib/types/database";

export type FieldResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export type ContactFieldKey =
  | "display_name"
  | "email"
  | "secondary_email"
  | "phone"
  | "whatsapp_phone"
  | "country"
  | "instagram_username"
  | "tiktok_username"
  | "twitter_username"
  | "facebook_id"
  | "youtube_channel_id"
  | "linkedin_profile_url"
  | "lead_temperature"
  | "next_followup_date"
  | "ai_conversation_summary";

type FieldKind = "text" | "email" | "phone" | "handle" | "url" | "temperature" | "date";

export interface ContactFieldDef {
  key: ContactFieldKey;
  label: string;
  kind: FieldKind;
  /** Ayuda debajo del input. */
  hint?: string;
}

/** El orden es el que usa el formulario de la ficha. */
export const CONTACT_FIELDS: ContactFieldDef[] = [
  { key: "display_name", label: "Nombre", kind: "text" },
  { key: "email", label: "Email", kind: "email" },
  { key: "secondary_email", label: "Email secundario", kind: "email" },
  { key: "phone", label: "Telefono", kind: "phone", hint: "Con codigo de pais, ej: +54 9 11 2233 4455" },
  { key: "whatsapp_phone", label: "WhatsApp", kind: "phone", hint: "Solo si es distinto al telefono principal" },
  { key: "country", label: "Pais", kind: "text" },
  { key: "instagram_username", label: "Instagram", kind: "handle", hint: "Sin la arroba" },
  { key: "tiktok_username", label: "TikTok", kind: "handle", hint: "Sin la arroba" },
  { key: "twitter_username", label: "Twitter / X", kind: "handle", hint: "Sin la arroba" },
  { key: "facebook_id", label: "Facebook", kind: "handle" },
  { key: "youtube_channel_id", label: "Canal de YouTube", kind: "text" },
  { key: "linkedin_profile_url", label: "LinkedIn", kind: "url", hint: "URL completa del perfil" },
  { key: "lead_temperature", label: "Temperatura", kind: "temperature" },
  { key: "next_followup_date", label: "Proximo seguimiento", kind: "date" },
  { key: "ai_conversation_summary", label: "Resumen del agente IA", kind: "text" },
];

const FIELD_BY_KEY = new Map(CONTACT_FIELDS.map((f) => [f.key, f]));

export const LEAD_TEMPERATURES: LeadTemperature[] = ["cold", "warm", "hot"];

export const LEAD_TEMPERATURE_LABELS: Record<LeadTemperature, string> = {
  cold: "Frio",
  warm: "Tibio",
  hot: "Caliente",
};

/**
 * Regex de email deliberadamente laxa: algo@algo.algo, sin espacios. Validar
 * emails "de verdad" con una regex es una trampa conocida — lo unico que
 * confirma que un email existe es mandarle un mail.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_TEXT = 500;
const MAX_LONG_TEXT = 10000;

/**
 * Normaliza y valida un campo. Vacio siempre es valido: todos son opcionales.
 *
 * `timeZone` solo importa para el campo "date": sin ella, un
 * <input type="datetime-local"> (sin zona en el string) se interpretaria en
 * la zona del SERVIDOR, que no es la de quien lo escribio.
 */
export function validateContactField(key: ContactFieldKey, raw: unknown, timeZone?: string): FieldResult {
  const def = FIELD_BY_KEY.get(key);
  if (!def) return { ok: false, error: `Campo desconocido: ${key}` };

  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: `${def.label} tiene que ser texto` };

  const value = raw.trim();
  if (!value) return { ok: true, value: null };

  switch (def.kind) {
    case "email": {
      const email = value.toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return { ok: false, error: `${def.label}: "${value}" no parece un email valido` };
      }
      return { ok: true, value: email };
    }

    case "phone": {
      const phone = normalizePhone(value);
      if (!phone) {
        return {
          ok: false,
          error: `${def.label}: "${value}" no es un numero valido. Incluí el codigo de pais.`,
        };
      }
      return { ok: true, value: phone };
    }

    case "handle": {
      // Sin arroba y en minusculas, que es como los busca find_or_link_contact.
      const handle = value.replace(/^@+/, "").trim().toLowerCase();
      if (!handle) return { ok: true, value: null };
      if (/\s/.test(handle)) {
        return { ok: false, error: `${def.label} no puede tener espacios` };
      }
      return { ok: true, value: handle.slice(0, MAX_TEXT) };
    }

    case "url": {
      // Se acepta sin esquema y se completa: la gente pega "linkedin.com/in/x".
      const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      try {
        const url = new URL(candidate);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("scheme");
        return { ok: true, value: url.toString().slice(0, MAX_TEXT) };
      } catch {
        return { ok: false, error: `${def.label}: "${value}" no parece una URL valida` };
      }
    }

    case "temperature": {
      if (!(LEAD_TEMPERATURES as string[]).includes(value)) {
        return { ok: false, error: `Temperatura invalida: ${value}` };
      }
      return { ok: true, value };
    }

    case "date": {
      // Un <input type="datetime-local"> sin zona en el string
      // ("YYYY-MM-DDTHH:mm", lo manda el editor de la ficha) se interpreta en
      // la zona de quien lo escribio, o un dia distinto segun la zona del
      // servidor. Cualquier otra forma (una fecha sola, un ISO con offset —
      // lo que mandan el CSV y FollowupField) se sigue parseando tal cual,
      // que es el comportamiento de siempre.
      const isBareDatetimeLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value);
      const iso = isBareDatetimeLocal
        ? datetimeInputToIso(value, timeZone ?? "UTC")
        : (() => {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
          })();

      if (!iso) {
        return { ok: false, error: `${def.label}: "${value}" no es una fecha valida` };
      }
      return { ok: true, value: iso };
    }

    default:
      return {
        ok: true,
        value: value.slice(0, key === "ai_conversation_summary" ? MAX_LONG_TEXT : MAX_TEXT),
      };
  }
}

export type ContactPatch = Partial<
  Omit<Record<ContactFieldKey, string | null>, "lead_temperature">
> & {
  lead_temperature?: LeadTemperature | null;
};

/**
 * Valida el formulario entero. Solo devuelve las claves que vinieron, asi un
 * formulario parcial no borra lo que no toco. Corta en el primer error para
 * que el mensaje sea uno solo y accionable.
 */
export function validateContactInput(
  input: Record<string, unknown>,
  timeZone?: string,
): { ok: true; patch: ContactPatch } | { ok: false; error: string } {
  const patch: ContactPatch = {};

  for (const def of CONTACT_FIELDS) {
    if (!(def.key in input)) continue;
    const result = validateContactField(def.key, input[def.key], timeZone);
    if (!result.ok) return result;
    if (def.key === "lead_temperature") {
      patch.lead_temperature = result.value as LeadTemperature | null;
    } else {
      patch[def.key] = result.value;
    }
  }

  return { ok: true, patch };
}
