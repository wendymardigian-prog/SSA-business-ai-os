/**
 * El mapeo de un envío a los datos de un contacto (F13): del payload y la URL a los campos del
 * contacto, los personalizados, los tags y la atribución. PURO y NUNCA lanza: un payload de afuera
 * puede venir con cualquier forma.
 *
 * Reglas:
 *  - Origen: una ruta con puntos sobre `{ payload, query }` (por defecto `payload.`; `query.utm_source`
 *    también vale), con índices (`items.0.email`), con rutas alternativas (la primera con valor) o un
 *    valor fijo.
 *  - Un destino sin valor se OMITE: nunca se escribe `undefined` ni `""`.
 *  - El teléfono SIEMPRE se normaliza con la misma regla del CRM (`normalizePhoneWithCountry`); el email,
 *    en minúsculas y sin espacios (como `find_contact_for_form`); los usuarios de redes con
 *    `normalizeSocialHandle`; el país con `resolveCountry`. Lo que no se reconoce queda en `errors` y no
 *    se escribe.
 */
import { resolveCountry } from "@/lib/contacts/country";
import { normalizeSocialHandle } from "@/lib/contacts/social";
import { normalizePhoneWithCountry } from "@/lib/scheduling/phone-countries";
import { CUSTOM_PREFIX, customSlugOf, isCustomTarget, socialPlatformOf, type CustomFieldDef } from "@/lib/forms/contact-config";
import { normalizeCustomValue } from "@/lib/custom-fields";
import { getByPath, scalarText } from "./paths";
import type { MapRow, MapSource, Transform, UpsertContactConfig } from "./upsert-config";

export interface MappingDefaults {
  /** Código ISO del país con el que se completan los teléfonos sin prefijo, si se sabe. */
  defaultCountry: string | null;
  /** Los campos personalizados del workspace (para validar el tipo y encontrar el slug). */
  customFields: CustomFieldDef[];
}

/** Lo que va a las columnas del contacto, ya normalizado. */
export interface MappedContactColumns {
  display_name?: string;
  email?: string;
  phone?: string;
  whatsapp_phone?: string;
  country?: string;
  instagram_username?: string;
  tiktok_username?: string;
  twitter_username?: string;
  linkedin_profile_url?: string;
  facebook_id?: string;
  youtube_channel_id?: string;
}

export type RowStatus = "ok" | "empty" | "error";

/** Una fila del mapeo tal como se muestra en «Probar con el ejemplo»: verde, gris o rojo. */
export interface RowResult {
  target: string;
  status: RowStatus;
  /** El valor ya normalizado (solo con `ok`). */
  value?: string;
  /** El texto de origen antes de normalizar. */
  raw?: string;
  reason?: string;
}

export interface MappingError {
  target: string;
  reason: string;
}

export interface MappingResult {
  contact: MappedContactColumns;
  /** `slug` del campo personalizado → valor en texto. */
  custom: Record<string, string>;
  /** Los tags elegidos a mano del payload (nombres), todavía sin buscar en el workspace. */
  tagNames: string[];
  /** La atribución mapeada a mano (clave → valor), sin la autodetectada. */
  attribution: Record<string, string>;
  rows: RowResult[];
  errors: MappingError[];
}

export const MAX_TEXT = 300;

// ---------------------------------------------------------------------------
// Origen
// ---------------------------------------------------------------------------

/** La raíz sobre la que se leen las rutas: `payload.x` / `query.x`, o `x` a secas = `payload.x`. */
export function readPath(payload: unknown, query: unknown, path: string): unknown {
  const root = { payload, query };
  if (path.startsWith("payload.") || path.startsWith("query.")) return getByPath(root, path);
  return getByPath(payload, path);
}

/** El valor de un origen como texto; null si no hay (ruta inexistente, vacío, objeto). */
export function readSource(payload: unknown, query: unknown, source: MapSource | undefined): string | null {
  if (!source) return null;
  if ("const" in source) return scalarText(source.const, MAX_TEXT);
  for (const p of [source.path, ...(source.fallbacks ?? [])]) {
    const value = readPath(payload, query, p);
    if (Array.isArray(value)) {
      const joined = value.map((v) => scalarText(v, MAX_TEXT)).filter((v): v is string => v !== null).join(", ");
      if (joined) return joined;
      continue;
    }
    const text = scalarText(value, MAX_TEXT);
    if (text !== null) return text;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Transformaciones
// ---------------------------------------------------------------------------

/** "Ana María Pérez" -> nombre "Ana María", apellido "Pérez". "Ana" -> nombre "Ana", apellido "". */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/**
 * Un teléfono limpio. Con prefijo (`+506…`, `00506…`) o con el país por defecto, E.164 como lo guarda el
 * CRM. Sin país por defecto y sin prefijo, solo los dígitos (8 a 15). Si no alcanza, null.
 */
export function cleanPhone(raw: string, defaultCountry: string | null): string | null {
  const e164 = normalizePhoneWithCountry(raw, defaultCountry);
  if (e164) return e164;
  if (defaultCountry) return null;
  const compact = raw.replace(/[\s().-]/g, "");
  if (compact.startsWith("+") || compact.startsWith("00")) return null;
  const digits = compact.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function applyTransform(text: string, transform: Transform | undefined, target: string): string {
  switch (transform) {
    case "lowercase":
      return text.toLowerCase();
    case "trim":
      return text.trim();
    case "split_name":
      if (target === "contact.first_name_part") return splitName(text).first;
      if (target === "contact.last_name_part") return splitName(text).last;
      return text;
    default:
      return text;
  }
}

// ---------------------------------------------------------------------------
// El mapeo
// ---------------------------------------------------------------------------

export function applyContactMapping(payload: unknown, query: unknown, config: Pick<UpsertContactConfig, "map" | "tags" | "attribution">, defaults: MappingDefaults): MappingResult {
  const result: MappingResult = { contact: {}, custom: {}, tagNames: [], attribution: {}, rows: [], errors: [] };
  let first = "";
  let last = "";

  const fail = (row: MapRow, raw: string, reason: string) => {
    result.rows.push({ target: row.target, status: "error", raw, reason });
    result.errors.push({ target: row.target, reason });
  };
  const ok = (row: MapRow, raw: string, value: string) => result.rows.push({ target: row.target, status: "ok", raw, value });

  try {
    for (const row of Array.isArray(config.map) ? config.map : []) {
      const raw = readSource(payload, query, row.source);
      if (raw === null) {
        result.rows.push({ target: row.target, status: "empty" });
        continue;
      }
      const text = applyTransform(raw, row.transform, row.target).trim();
      if (text === "") {
        result.rows.push({ target: row.target, status: "empty", raw });
        continue;
      }

      switch (row.target) {
        case "contact.display_name":
          result.contact.display_name = text.slice(0, 200);
          ok(row, raw, result.contact.display_name);
          break;
        case "contact.first_name_part":
          first = text.slice(0, 100);
          ok(row, raw, first);
          break;
        case "contact.last_name_part":
          last = text.slice(0, 100);
          ok(row, raw, last);
          break;
        case "contact.email": {
          const email = text.toLowerCase().replace(/\s+/g, "");
          if (!EMAIL.test(email)) fail(row, raw, "email_invalido");
          else {
            result.contact.email = email;
            ok(row, raw, email);
          }
          break;
        }
        case "contact.phone":
        case "contact.whatsapp_phone": {
          const phone = cleanPhone(text, defaults.defaultCountry);
          if (!phone) {
            fail(row, raw, "telefono_invalido");
            break;
          }
          if (row.target === "contact.phone") result.contact.phone = phone;
          else result.contact.whatsapp_phone = phone;
          ok(row, raw, phone);
          break;
        }
        case "contact.country": {
          const country = resolveCountry(text);
          if (!country) fail(row, raw, "pais_no_reconocido");
          else {
            result.contact.country = country;
            ok(row, raw, country);
          }
          break;
        }
        default: {
          const platform = socialPlatformOf(row.target);
          if (platform) {
            const handle = normalizeSocialHandle(platform, text);
            if (!handle.ok) {
              fail(row, raw, "usuario_invalido");
              break;
            }
            const column = row.target.slice("contact.".length) as keyof MappedContactColumns;
            result.contact[column] = handle.value;
            ok(row, raw, handle.value);
            break;
          }
          if (isCustomTarget(row.target)) {
            const slug = customSlugOf(row.target);
            const def = defaults.customFields.find((c) => c.slug === slug);
            if (!def) {
              fail(row, raw, "campo_personalizado_inexistente");
              break;
            }
            const value = normalizeCustomValue(def.type, text);
            if (!value.ok) fail(row, raw, value.reason);
            else {
              result.custom[slug] = value.value;
              ok(row, raw, value.value);
            }
            break;
          }
          fail(row, raw, "destino_desconocido");
        }
      }
    }

    // Sin nombre completo, se junta el nombre con el apellido (como Formularios).
    if (!result.contact.display_name && (first || last)) {
      result.contact.display_name = [first, last].filter(Boolean).join(" ").slice(0, 200);
    }

    // Tags "desde el payload": nombres separados por coma, sin repetir.
    const tagText = readSource(payload, query, config.tags?.fromSource);
    if (tagText) {
      const seen = new Set<string>();
      for (const part of tagText.split(",")) {
        const name = part.trim().slice(0, 60);
        if (name && !seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          result.tagNames.push(name);
        }
      }
    }

    // Atribución mapeada a mano.
    for (const entry of Array.isArray(config.attribution?.map) ? config.attribution.map : []) {
      const value = readSource(payload, query, entry.source);
      if (value !== null) result.attribution[entry.key] = value;
    }
  } catch (err) {
    // Nunca lanza: lo que se alcanzó a leer queda, y el motivo se anota.
    result.errors.push({ target: "*", reason: `error_inesperado:${err instanceof Error ? err.message : "desconocido"}` });
  }

  return result;
}

/** ¿El mapeo tiene con qué identificar a alguien? (teléfono, WhatsApp, email o red). Nunca por nombre. */
export function hasIdentifier(contact: MappedContactColumns): boolean {
  return !!(contact.email || contact.phone || contact.whatsapp_phone || contact.instagram_username || contact.tiktok_username || contact.twitter_username || contact.linkedin_profile_url);
}

export { CUSTOM_PREFIX };

// ---------------------------------------------------------------------------
// Sugerencia automática al elegir el ejemplo
// ---------------------------------------------------------------------------

const HINTS: Array<{ target: string; transform?: Transform; keys: string[] }> = [
  { target: "contact.email", transform: "lowercase", keys: ["email", "correo", "e_mail", "mail", "email_address"] },
  { target: "contact.phone", transform: "clean_phone", keys: ["phone", "telefono", "tel", "celular", "mobile", "phone_number"] },
  { target: "contact.whatsapp_phone", transform: "clean_phone", keys: ["whatsapp", "whatsapp_phone", "wa"] },
  { target: "contact.display_name", keys: ["name", "nombre", "full_name", "fullname", "nombre_completo"] },
  { target: "contact.first_name_part", keys: ["first_name", "firstname", "nombre_pila", "given_name"] },
  { target: "contact.last_name_part", keys: ["last_name", "lastname", "apellido", "family_name", "surname"] },
];

/**
 * Las filas que se sugieren a partir de las claves obvias del ejemplo (en la raíz del payload). NO pisa
 * una fila ya elegida (mismo criterio que `autoMapOnFieldAdded` de Formularios): solo agrega destinos
 * que todavía no tienen una fila.
 */
export function suggestMapRows(samplePayload: unknown, existing: MapRow[]): MapRow[] {
  if (typeof samplePayload !== "object" || samplePayload === null || Array.isArray(samplePayload)) return existing;
  const keys = Object.keys(samplePayload as Record<string, unknown>);
  const out = [...existing];
  for (const hint of HINTS) {
    if (out.some((r) => r.target === hint.target)) continue;
    const found = keys.find((k) => hint.keys.includes(k.toLowerCase()) && scalarText((samplePayload as Record<string, unknown>)[k]) !== null);
    if (found) out.push({ target: hint.target, source: { path: found }, ...(hint.transform ? { transform: hint.transform } : {}) });
  }
  return out;
}
