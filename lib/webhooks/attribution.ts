/**
 * La atribución de un webhook (F14): qué datos de origen (UTMs, ids de anuncio, ids de clic) trae el
 * envío y cómo se arma el toque. PURO.
 *
 * Atribución efectiva = lo mapeado a mano + (si `autoDetect`) lo que no se mapeó y se encuentra solo.
 * La detección busca cada clave de `ATTRIBUTION_KEYS` (más `landing_page` y `referrer_url`), sin
 * distinguir mayúsculas y con los alias de `KEY_ALIASES`, en este orden: la URL (`query`), la raíz del
 * payload y los contenedores habituales (`hidden`, `utm`…, un nivel adentro). Gana el primero.
 */
import { ATTRIBUTION_KEYS, KEY_ALIASES, MAX_VALUE_LENGTH } from "@/lib/attribution/keys";
import { normalizeMedium, normalizeSource } from "@/lib/contacts/taxonomy";
import type { TouchInput } from "@/lib/contacts/touch";
import type { TouchMedium } from "./upsert-config";

/** Las claves que se buscan: las de atribución más las dos páginas. */
export const WEBHOOK_ATTRIBUTION_KEYS: readonly string[] = [...ATTRIBUTION_KEYS, "landing_page", "referrer_url"];
const KEY_SET = new Set(WEBHOOK_ATTRIBUTION_KEYS);

/** Donde los formularios externos suelen poner las UTMs ocultas. */
export const ATTRIBUTION_CONTAINERS = ["hidden", "utm", "utms", "tracking", "attribution", "attributionsource", "customdata", "custom_data", "fields", "meta", "context"] as const;

/** Un valor sin reemplazar del estilo `{{campaign.id}}` o `{campaign.id}`: lo escribió la persona en la URL del anuncio y no se resolvió. */
const PLACEHOLDER = /^\{\{?[^{}]*\}\}?$/;

/** La clave en minúsculas y con su alias, o null si no es de atribución. */
export function canonicalWebhookKey(key: string): string | null {
  const lower = key.trim().toLowerCase();
  const aliased = KEY_ALIASES[lower] ?? lower;
  return KEY_SET.has(aliased) ? aliased : null;
}

/** Limpia un valor: lo que no sirve, null. */
export function cleanAttributionValue(key: string, value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "" || PLACEHOLDER.test(text) || text === "undefined" || text === "null") return null;
  // Un id pegado por error en la fuente (`utm_source=1202345678901234`): no es una fuente.
  if (key === "utm_source" && /^\d{9,}$/.test(text)) return null;
  return text.slice(0, MAX_VALUE_LENGTH);
}

const asRecord = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/** Los datos de origen que se encuentran solos. */
export function detectAttribution(payload: unknown, query: unknown): Record<string, string> {
  const found: Record<string, string> = {};
  const take = (source: Record<string, unknown> | null) => {
    if (!source) return;
    for (const [rawKey, rawValue] of Object.entries(source)) {
      const key = canonicalWebhookKey(rawKey);
      if (!key || key in found) continue;
      const value = cleanAttributionValue(key, rawValue);
      if (value) found[key] = value;
    }
  };

  take(asRecord(query));
  const root = asRecord(payload);
  take(root);
  if (root) {
    for (const [name, value] of Object.entries(root)) {
      if ((ATTRIBUTION_CONTAINERS as readonly string[]).includes(name.toLowerCase())) take(asRecord(value));
    }
  }
  return found;
}

/** Lo mapeado a mano gana; si `autoDetect`, se completa con lo que se encontró solo. */
export function effectiveAttribution(args: { payload: unknown; query: unknown; mapped: Record<string, string>; autoDetect: boolean }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(args.mapped)) {
    const key = canonicalWebhookKey(rawKey) ?? rawKey;
    const value = cleanAttributionValue(key, rawValue);
    if (value) out[key] = value;
  }
  if (args.autoDetect) {
    for (const [key, value] of Object.entries(detectAttribution(args.payload, args.query))) {
      if (!(key in out)) out[key] = value;
    }
  }
  return out;
}

/** Las claves de `raw` del toque que no tienen columna propia. */
const RAW_KEYS_OF_TOUCH = ["utm_id", "placement", "fbp", "fbc", "ga_client_id"] as const;

/**
 * El toque de un envío: `origin = "webhook"`, fuente de la UTM (o `webhook`), medio `form` si el paso es
 * un formulario externo (o el de la UTM / `referral`). El primero y el último los decide la base.
 */
export function buildWebhookTouch(args: {
  attribution: Record<string, string>;
  touchMedium: TouchMedium;
  inboundId: string;
  nodeId: string;
  endpointId: string;
  endpointName: string;
  occurredAt?: Date | null;
}): TouchInput {
  const a = args.attribution;
  const utmMedium = a.utm_medium ? normalizeMedium(a.utm_medium).medium : null;
  const raw: Record<string, unknown> = { endpoint_id: args.endpointId, endpoint_name: args.endpointName, source_type: "webhook" };
  for (const key of RAW_KEYS_OF_TOUCH) if (a[key]) raw[key] = a[key];

  return {
    ...(args.occurredAt ? { occurredAt: args.occurredAt } : {}),
    source: normalizeSource(a.utm_source) ?? "webhook",
    medium: args.touchMedium === "external_form" ? "form" : utmMedium ?? "referral",
    campaign: a.utm_campaign ?? null,
    content: a.utm_content ?? null,
    term: a.utm_term ?? null,
    adId: a.ad_id ?? null,
    adsetId: a.adset_id ?? null,
    campaignId: a.campaign_id ?? null,
    fbclid: a.fbclid ?? null,
    gclid: a.gclid ?? null,
    ttclid: a.ttclid ?? null,
    liFatId: a.li_fat_id ?? null,
    referrerUrl: a.referrer_url ?? null,
    landingPage: a.landing_page ?? null,
    origin: "webhook",
    dedupeKey: `webhook:${args.inboundId}:${args.nodeId}`,
    raw,
  };
}
