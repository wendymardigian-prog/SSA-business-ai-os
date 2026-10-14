/**
 * Arma la atribución de una visita desde la URL, el referrer y las cookies de
 * los anuncios (F6). PURA y sin dependencias de servidor: la usan la página,
 * el servidor al re-sanear lo que manda el navegador, y el script de embed.
 *
 * Nada se inventa: una clave que no vino no aparece. Cada valor se recorta a
 * 200 caracteres y se limpia de caracteres de control.
 */
import { ATTRIBUTION_KEYS, COOKIE_KEYS, MAX_VALUE_LENGTH, TOUCH_KEYS, canonicalKey } from "./keys";
import { ENTRY_URL_KEY, entryUrlFrom } from "./entry-url";
import type { Attribution } from "./types";

type ParamsInput = Record<string, string | string[] | undefined | null> | URLSearchParams;

export interface CollectOptions {
  /** `document.referrer` (o la cabecera `Referer`). */
  referrer?: string | null;
  /** Página de llegada de la visita (URL completa). */
  landing?: string | null;
  /** Página donde está el formulario (URL completa). */
  pageUrl?: string | null;
  /** Las cookies por su nombre: `_fbp`, `_fbc`, `_ga`. */
  cookies?: Record<string, string | undefined | null>;
  /** Milisegundos desde epoch; para armar `fbc`. Por defecto, ahora. */
  now?: number;
}

/** Texto limpio y recortado, o null si queda vacío. */
export function cleanValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_VALUE_LENGTH);
  return cleaned === "" ? null : cleaned;
}

function entriesOf(params: ParamsInput): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (params instanceof URLSearchParams) {
    params.forEach((value, key) => out.push([key, value]));
    return out;
  }
  for (const [key, raw] of Object.entries(params)) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string") out.push([key, value]);
  }
  return out;
}

/** Una URL http(s) válida, o null. Mismo criterio que `safeReferrer` de la Agenda, sin traer `node:crypto`. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

/** La página de llegada: origen + ruta + SOLO las claves de atribución de la query. */
export function landingFromUrl(value: unknown): string | null {
  const href = safeUrl(value);
  if (!href) return null;
  const url = new URL(href);
  const keep = new URLSearchParams();
  url.searchParams.forEach((v, k) => {
    if (canonicalKey(k) && TOUCH_KEYS.includes(canonicalKey(k) as string)) {
      const clean = cleanValue(v);
      if (clean) keep.append(k, clean);
    }
  });
  const query = keep.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`.slice(0, 500);
}

/** La URL de la página donde está el formulario, sin query (puede traer datos de la persona). */
export function pageUrlFromUrl(value: unknown): string | null {
  const href = safeUrl(value);
  if (!href) return null;
  const url = new URL(href);
  return `${url.origin}${url.pathname}`.slice(0, 500);
}

/** `_ga` → los dos últimos números (`GA1.1.123.456` → `123.456`). */
export function gaClientId(cookie: string | null | undefined): string | null {
  const clean = cleanValue(cookie);
  if (!clean) return null;
  const parts = clean.split(".");
  if (parts.length < 4) return null;
  const id = parts.slice(-2).join(".");
  return /^\d+\.\d+$/.test(id) ? id : null;
}

/** Separa un encabezado `Cookie` en un mapa nombre → valor. */
export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      out[name] = part.slice(index + 1).trim();
    }
  }
  return out;
}

export function attributionFromParams(params: ParamsInput, options: CollectOptions = {}): Attribution {
  const out: Attribution = {};

  for (const [rawKey, rawValue] of entriesOf(params)) {
    const key = canonicalKey(rawKey);
    // Las claves de cookie (fbp, fbc, ga_client_id) solo se aceptan desde las cookies reales.
    if (!key || !TOUCH_KEYS.includes(key)) continue;
    const value = cleanValue(rawValue);
    if (value && out[key] === undefined) out[key] = value;
  }

  const cookies = options.cookies ?? {};
  const fbp = cleanValue(cookies["_fbp"]);
  if (fbp) out[COOKIE_KEYS._fbp] = fbp;
  const fbc = cleanValue(cookies["_fbc"]);
  if (fbc) out[COOKIE_KEYS._fbc] = fbc;
  const ga = gaClientId(cookies["_ga"]);
  if (ga) out[COOKIE_KEYS._ga] = ga;

  // Meta arma `fbc` a partir de `fbclid` cuando todavía no hay cookie.
  if (!out.fbc && out.fbclid) {
    out.fbc = `fb.1.${options.now ?? Date.now()}.${out.fbclid}`.slice(0, MAX_VALUE_LENGTH + 20);
  }

  const referrer = safeUrl(options.referrer);
  if (referrer) out.referrer_url = referrer;
  const landing = landingFromUrl(options.landing);
  if (landing) out.landing_page = landing;
  const pageUrl = pageUrlFromUrl(options.pageUrl);
  if (pageUrl) out.page_url = pageUrl;
  // La URL de entrada completa (plano formularios-ui, F17): un dato APARTE de `landing_page`, que sigue filtrada.
  const entry = entryUrlFrom(options.landing);
  if (entry) out[ENTRY_URL_KEY] = entry;

  return out;
}

/** ¿La atribución trae algo que haga de la visita un toque nuevo (UTM, id de clic o de anuncio)? */
export function hasTouchKeys(attribution: Record<string, unknown> | null | undefined): boolean {
  if (!attribution) return false;
  return TOUCH_KEYS.some((key) => typeof attribution[key] === "string" && attribution[key] !== "");
}


/**
 * Vuelve a sanear una atribución que mandó el NAVEGADOR (o la cookie): el
 * servidor no confía en ella. Se queda solo con las claves de `keys.ts`, cada
 * valor recortado y limpio, y las tres URLs revalidadas. `first_visit` (la
 * primera visita persistida) pasa por la misma regla, con su `ts` numérico.
 */
export function sanitizeAttribution(raw: unknown): Attribution & { first_visit?: Record<string, string | number> } {
  const out: Attribution & { first_visit?: Record<string, string | number> } = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const source = raw as Record<string, unknown>;

  for (const key of ATTRIBUTION_KEYS) {
    const value = cleanValue(source[key]);
    if (value) out[key] = value;
  }
  const referrer = safeUrl(source.referrer_url);
  if (referrer) out.referrer_url = referrer;
  const landing = landingFromUrl(source.landing_page);
  if (landing) out.landing_page = landing;
  const pageUrl = pageUrlFromUrl(source.page_url);
  if (pageUrl) out.page_url = pageUrl;
  // Se vuelve a sanear aca: el servidor no confia en la URL que manda el navegador.
  const entry = entryUrlFrom(source[ENTRY_URL_KEY]);
  if (entry) out[ENTRY_URL_KEY] = entry;

  const first = source.first_visit;
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const visit: Record<string, string | number> = {};
    const f = first as Record<string, unknown>;
    for (const key of ATTRIBUTION_KEYS) {
      const value = cleanValue(f[key]);
      if (value) visit[key] = value;
    }
    const fReferrer = safeUrl(f.referrer_url);
    if (fReferrer) visit.referrer_url = fReferrer;
    const fLanding = landingFromUrl(f.landing_page);
    if (fLanding) visit.landing_page = fLanding;
    const fEntry = entryUrlFrom(f[ENTRY_URL_KEY]);
    if (fEntry) visit[ENTRY_URL_KEY] = fEntry;
    if (typeof f.ts === "number" && Number.isFinite(f.ts)) visit.ts = f.ts;
    if (Object.keys(visit).length > 0) out.first_visit = visit;
  }
  return out;
}
