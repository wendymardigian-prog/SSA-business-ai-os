/**
 * Prellenado por URL y campos ocultos (F6, decisión 184).
 *
 * `prefillFromParams` recorre los parámetros que cada campo declara (por
 * defecto, su clave) y toma el PRIMERO que venga con un valor VÁLIDO. Un valor
 * que no pasa la validación de su campo se ignora entero: el campo queda vacío,
 * nunca a medias. El consentimiento, los archivos y la firma nunca se prellenan.
 *
 * Es solo comodidad: el servidor trata lo que llega como cualquier otra
 * respuesta (lo valida, no se fía de que "estaba bloqueado").
 */
import { normalizeSocialHandle } from "@/lib/contacts/social";
import { normalizePhoneWithCountry } from "@/lib/scheduling/phone-countries";
import { PREFILL_PARAM_RE, supportsPrefill, type FormField, type PrefillConfig } from "./fields";

export type PrefillValue = string | number | string[];

export interface PrefillResult {
  values: Record<string, PrefillValue>;
  /** Campos que aparecen llenos y deshabilitados. */
  locked: Set<string>;
  /** Campos que, por venir llenos, no se muestran (se envían igual). */
  hiddenByPrefill: Set<string>;
}

export type ParamsMap = Record<string, string | string[] | undefined | null>;

export interface PrefillOptions {
  /** Valores fijados por quien pega el embed o usa `<Formulario prefill>`: ganan sobre la URL. */
  explicit?: Record<string, string | number | undefined | null>;
  defaultCountry?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SHORT = 500;
const MAX_LONG = 5000;

/** Lo que una persona puede dejar escrito en el campo, o null si no es válido para él. */
export function coercePrefillValue(
  field: FormField,
  raw: string,
  defaultCountry?: string | null,
): PrefillValue | null {
  const text = raw.trim();
  if (text === "") return null;

  switch (field.type) {
    case "short_text":
      return text.length <= MAX_SHORT ? text : null;
    case "long_text":
      return text.length <= MAX_LONG ? text : null;
    case "email": {
      const email = text.toLowerCase();
      return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
    }
    case "phone":
      return normalizePhoneWithCountry(text, defaultCountry ?? undefined);
    case "social": {
      if (!field.social) return null;
      const handle = normalizeSocialHandle(field.social.platform, text);
      return handle.ok ? handle.value : null;
    }
    case "number": {
      const n = Number(text);
      if (!Number.isFinite(n)) return null;
      if (field.min !== undefined && n < field.min) return null;
      if (field.max !== undefined && n > field.max) return null;
      return n;
    }
    case "rating":
    case "nps": {
      const n = Number(text);
      if (!Number.isInteger(n)) return null;
      const min = field.type === "rating" ? 1 : 0;
      const max = field.type === "rating" ? 5 : 10;
      return n >= min && n <= max ? n : null;
    }
    case "date": {
      if (!ISO_DATE_RE.test(text)) return null;
      const d = new Date(`${text}T00:00:00Z`);
      return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text ? null : text;
    }
    case "single_select": {
      const match = (field.options ?? []).find((o) => o.trim().toLowerCase() === text.toLowerCase());
      return match ?? null;
    }
    case "multi_select": {
      const wanted = text.split(",").map((s) => s.trim()).filter(Boolean);
      if (wanted.length === 0) return null;
      const options = field.options ?? [];
      const resolved: string[] = [];
      for (const item of wanted) {
        const match = options.find((o) => o.trim().toLowerCase() === item.toLowerCase());
        if (!match) return null; // un valor inválido invalida todo
        if (!resolved.includes(match)) resolved.push(match);
      }
      return resolved;
    }
    default:
      return null;
  }
}

function lowerMap(params: ParamsMap): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(params)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (typeof v === "string" && v !== "") map.set(key.toLowerCase(), v);
  }
  return map;
}

/** La configuración efectiva de prellenado de un campo (con los valores por defecto). */
export function effectivePrefill(field: FormField): PrefillConfig | null {
  if (!supportsPrefill(field.type) || field.type === "hidden") return null;
  return field.prefill ?? { params: [field.key], behavior: "editable" };
}

export function prefillFromParams(fields: FormField[], params: ParamsMap, options: PrefillOptions = {}): PrefillResult {
  const url = lowerMap(params);
  const explicit = new Map<string, string>();
  for (const [key, value] of Object.entries(options.explicit ?? {})) {
    if (value !== undefined && value !== null && String(value) !== "") explicit.set(key.toLowerCase(), String(value));
  }

  const result: PrefillResult = { values: {}, locked: new Set(), hiddenByPrefill: new Set() };

  for (const field of fields) {
    const config = effectivePrefill(field);
    if (!config) continue;

    for (const param of config.params) {
      const raw = explicit.get(param.toLowerCase()) ?? url.get(param.toLowerCase());
      if (raw === undefined) continue;
      const value = coercePrefillValue(field, raw, options.defaultCountry);
      if (value === null) continue; // lo que no es válido se ignora y se prueba con el siguiente parámetro
      result.values[field.key] = value;
      if (config.behavior === "locked") result.locked.add(field.key);
      if (config.behavior === "hidden") result.hiddenByPrefill.add(field.key);
      break;
    }
  }

  return result;
}

/**
 * Los valores de los campos ocultos que se toman de la URL o de la atribución.
 * Los de tipo `fixed` NO están acá: su valor no sale nunca del servidor.
 */
export function hiddenValues(
  fields: FormField[],
  params: ParamsMap,
  attribution: Record<string, string | undefined> = {},
): Record<string, string> {
  const url = lowerMap(params);
  const out: Record<string, string> = {};
  for (const field of fields) {
    if (field.type !== "hidden" || !field.hidden) continue;
    const { source, param } = field.hidden;
    let value: string | undefined;
    if (source === "url_param" && param) value = url.get(param.toLowerCase());
    else if (source === "attribution" && param) value = attribution[param];
    if (value) out[field.key] = value.slice(0, 500);
  }
  return out;
}

// ── "Parámetros de la URL" y el armador de links (F32) ───────────────────────

export interface PrefillParamRow {
  fieldKey: string;
  label: string;
  /** Los parámetros que lo llenan, en orden de prioridad. */
  params: string[];
  behavior: PrefillConfig["behavior"];
}

export interface HiddenParamRow {
  fieldKey: string;
  label: string;
  /** De dónde sale su valor: un parámetro de la URL o una clave de atribución. */
  source: "url_param" | "attribution";
  param: string;
}

export interface AutoAttributionGroup {
  title: string;
  keys: string[];
}

/** Lo que el sistema registra solo: la persona que arma links no tiene que hacer nada con estas claves. */
export const AUTO_ATTRIBUTION_GROUPS: AutoAttributionGroup[] = [
  { title: "Campaña (UTM)", keys: ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id"] },
  { title: "Ids de clic de los anuncios", keys: ["fbclid", "gclid", "gbraid", "wbraid", "msclkid", "ttclid", "li_fat_id", "twclid", "sccid", "epik", "rdt_cid"] },
  { title: "Ids del anuncio", keys: ["ad_id", "adset_id", "campaign_id", "placement"] },
  { title: "Cookies de los anuncios", keys: ["fbp", "fbc", "ga_client_id"] },
];

export interface DescribedPrefill {
  fields: PrefillParamRow[];
  hidden: HiddenParamRow[];
  auto: AutoAttributionGroup[];
}

/**
 * Qué parámetros acepta la URL de un formulario: los campos que se pueden prellenar (con
 * su comportamiento), los ocultos que toman su valor de la URL o de la atribución y lo
 * que se registra solo. NUNCA lista un campo de consentimiento ni de archivo (no se
 * prellenan) ni el `value` de un oculto fijo (jamás sale del servidor): de esos, ni el
 * campo aparece.
 */
export function describePrefillParams(definition: { fields: FormField[] }): DescribedPrefill {
  const fields: PrefillParamRow[] = [];
  const hidden: HiddenParamRow[] = [];
  for (const field of definition.fields) {
    if (field.type === "hidden") {
      const config = field.hidden;
      if (config && (config.source === "url_param" || config.source === "attribution") && config.param) {
        hidden.push({ fieldKey: field.key, label: field.label || field.key, source: config.source, param: config.param });
      }
      continue;
    }
    const config = effectivePrefill(field);
    if (!config) continue;
    fields.push({ fieldKey: field.key, label: field.label || field.key, params: [...config.params], behavior: config.behavior });
  }
  return { fields, hidden, auto: AUTO_ATTRIBUTION_GROUPS };
}

/** Las variables del contacto que se pueden pegar sin codificar en un mensaje o email de una automatización. */
export const CONTACT_LINK_VARIABLES = ["{{contact.display_name}}", "{{contact.email}}", "{{contact.phone}}"] as const;

const CONTACT_TOKEN = /(\{\{\s*contact\.[a-z_]+\s*\}\})/gi;

/** El valor codificado para una URL, salvo las variables `{{contact.*}}`, que quedan tal cual. */
function encodeLinkValue(value: string): string {
  return value
    .split(CONTACT_TOKEN)
    .map((part) => (CONTACT_TOKEN.test(part) ? part.replace(/\s+/g, "") : encodeURIComponent(part)))
    .join("");
}

/**
 * La URL de un formulario con valores prellenados. Los valores se codifican, menos las
 * variables del contacto (`{{contact.email}}`…), que van sin codificar para que el nodo
 * de envío de una automatización las reemplace como a cualquier variable. Los nombres
 * inválidos y los valores vacíos se ignoran.
 */
export function buildPrefillLink(baseUrl: string, values: Record<string, string | undefined | null>): string {
  const pairs: string[] = [];
  for (const [name, raw] of Object.entries(values)) {
    if (typeof raw !== "string" || raw.trim() === "") continue;
    if (!PREFILL_PARAM_RE.test(name)) continue;
    pairs.push(`${encodeURIComponent(name)}=${encodeLinkValue(raw.trim())}`);
  }
  if (pairs.length === 0) return baseUrl;
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${pairs.join("&")}`;
}
