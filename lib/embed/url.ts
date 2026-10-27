// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * La URL que carga el iframe del embed (F39). Adaptado de `createIframe` de
 * `embed-core/src/embed.ts`: se conservan la precarga, el tema y los UTM de
 * la página padre.
 *
 * Es código puro compartido: lo usa el script del embed (en el navegador del
 * cliente) y el generador de código (en la app).
 */
import { normalizeHexColor, UTM_KEYS, CLICK_ID_KEYS, type BookerTheme, BOOKER_THEMES } from "@/lib/scheduling/booker/embed-params";
import { IDENTIFIER_RE } from "@/lib/scheduling/identifier";
import { TOUCH_KEYS, canonicalKey } from "@/lib/attribution/keys";
import { isSensitiveParamName } from "@/lib/attribution/sensitive-params";

export const CAL_LINK_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;

/**
 * Un formulario se embebe con `f/<slug>` y carga `/f/<slug>` (no `/calendario/...`).
 * `f` ya cumple `CAL_LINK_RE` (usuario `f`, evento `<slug>`), por eso esta es la
 * que decide: la Agenda nunca tuvo un usuario llamado `f`.
 */
export const FORM_LINK_RE = /^f\/[a-z0-9-]{3,60}$/;

export function isFormLink(calLink: string): boolean {
  return FORM_LINK_RE.test(calLink);
}

export function formSlugOfLink(calLink: string): string | null {
  return isFormLink(calLink) ? calLink.slice(2) : null;
}

/** La configuración que acepta `Agenda("inline"|"floatingButton", {config})` y `data-agenda-config`. */
export interface EmbedConfig {
  theme?: BookerTheme | string | null;
  /** Color principal, hex. `brandColor` es el alias que usa `Agenda("ui")`. */
  color?: string | null;
  brandColor?: string | null;
  hideEventTypeDetails?: boolean;
  layout?: "month_view";
  /** Zona del invitado, si el cliente la conoce. */
  tz?: string;
  name?: string;
  email?: string;
  phone?: string;
  /** Precarga de otras preguntas, por identificador. */
  [key: string]: unknown;
}

export type ParentUtm = Partial<Record<(typeof UTM_KEYS)[number] | (typeof CLICK_ID_KEYS)[number], string>>;

/**
 * Los datos de atribucion de la pagina padre de un FORMULARIO: todas las claves
 * de `lib/attribution/keys.ts` (UTM, ids de clic de cada plataforma, ids de
 * anuncio). La Agenda sigue usando solo las suyas (`parentUtmFromSearch`).
 */
export type ParentAttribution = Record<string, string>;

export function parentAttributionFromSearch(search: string): ParentAttribution {
  const params = new URLSearchParams(search);
  const out: ParentAttribution = {};
  params.forEach((value, rawKey) => {
    const key = canonicalKey(rawKey);
    const v = value.trim();
    if (key && TOUCH_KEYS.includes(key) && v && !(key in out)) out[key] = v.slice(0, MAX_TEXT);
  });
  return out;
}

// ── Formularios: lo que la pagina que lo contiene le pasa al iframe ─────────

const HOST_PARAM_NAME_RE = /^[a-zA-Z0-9_.-]{1,40}$/;
const MAX_HOST_PARAMS = 30;
const MAX_HOST_VALUE = 500;
// Los nombres que nunca se reenvian (credenciales, sesiones) viven en `lib/attribution/sensitive-params.ts`:
// los comparte la URL de entrada (plano formularios-ui, F17), una sola copia.
/** Nombres con significado propio en la URL del iframe. */
const RESERVED_PARAM_NAMES = new Set(["embed", "referrer", "attr", "preview", "c", "website"]);

/**
 * Los parametros de la URL de la pagina que embebe, filtrados para pasarlos al
 * formulario (que solo usa los que declara). Nunca pasan: nombres raros, los que
 * parecen credenciales, los que empiezan con `_`, ni los de atribucion (esos van
 * aparte). Hasta 30, de hasta 500 caracteres.
 */
export function filterHostParams(params: Record<string, string | undefined | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(params)) {
    if (Object.keys(out).length >= MAX_HOST_PARAMS) break;
    if (typeof raw !== "string" || raw === "") continue;
    if (!HOST_PARAM_NAME_RE.test(name) || name.startsWith("_")) continue;
    const lower = name.toLowerCase();
    if (isSensitiveParamName(name) || RESERVED_PARAM_NAMES.has(lower) || canonicalKey(name)) continue;
    out[name] = raw.slice(0, MAX_HOST_VALUE);
  }
  return out;
}

export interface FormEmbedExtras {
  /** Los parametros de la URL de la pagina que embebe (se filtran aca). */
  hostParams?: Record<string, string | undefined | null>;
  /** La atribucion y las cookies de esa pagina, ya codificadas (`lib/attribution/embed-attr.ts`). */
  attr?: string | null;
  /** Atribucion de la URL de la pagina padre con las claves de formularios. */
  parentAttribution?: ParentAttribution;
}

const KNOWN_KEYS = new Set(["theme", "color", "brandColor", "hideEventTypeDetails", "layout", "tz", "name", "email", "phone", "referrer"]);
const MAX_TEXT = 500;

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value).trim();
  return s ? s.slice(0, MAX_TEXT) : null;
}

/** Los UTM y click ids presentes en la URL de la página padre. */
export function parentUtmFromSearch(search: string): ParentUtm {
  const params = new URLSearchParams(search);
  const out: ParentUtm = {};
  for (const k of [...UTM_KEYS, ...CLICK_ID_KEYS]) {
    const v = params.get(k);
    if (v && v.trim()) out[k] = v.trim().slice(0, MAX_TEXT);
  }
  return out;
}

/**
 * `buildEmbedIframeUrl("ana/llamada", {theme: "dark", color: "#aa00ff"}, {utm_source: "web"})`
 * → `/calendario/ana/llamada?embed=1&theme=dark&color=%23aa00ff&utm_source=web`
 *
 * Con `origin` devuelve la URL absoluta. Un color que no es hex se ignora.
 */
export function buildEmbedIframeUrl(
  calLink: string,
  config: EmbedConfig = {},
  parentUtm: ParentUtm = {},
  origin?: string,
  extras: FormEmbedExtras = {},
): string {
  if (!CAL_LINK_RE.test(calLink)) throw new Error(`calLink inválido: "${calLink}" (esperado usuario/evento)`);
  if (isFormLink(calLink)) return buildFormIframeUrl(calLink, config, parentUtm, origin, extras);

  const params = new URLSearchParams();
  params.set("embed", "1");

  const theme = text(config.theme);
  if (theme && (BOOKER_THEMES as string[]).includes(theme)) params.set("theme", theme);

  const color = normalizeHexColor(text(config.color) ?? text(config.brandColor));
  if (color) params.set("color", color);

  if (config.hideEventTypeDetails) params.set("hideEventTypeDetails", "1");
  if (config.layout === "month_view") params.set("layout", "month_view");
  const tz = text(config.tz);
  if (tz) params.set("tz", tz);

  for (const k of ["name", "email", "phone"] as const) {
    const v = text(config[k]);
    if (v) params.set(k, v);
  }

  for (const [k, v] of Object.entries(config)) {
    if (KNOWN_KEYS.has(k) || !IDENTIFIER_RE.test(k)) continue;
    const s = text(v);
    if (s) params.set(k, s);
  }

  for (const k of [...UTM_KEYS, ...CLICK_ID_KEYS]) {
    const v = parentUtm[k];
    if (v) params.set(k, v);
  }

  // La atribucion efectiva de la web que embebe (su URL, su localStorage y sus cookies de anuncios), igual
  // que a los formularios. Solo si trae algo: sin atribucion la URL es la de siempre (Extra L, F16).
  if (extras.attr) params.set("attr", extras.attr);

  const referrer = text(config.referrer);
  if (referrer && /^https?:\/\//i.test(referrer)) params.set("referrer", referrer);

  const path = `/calendario/${calLink}?${params.toString()}`;
  return origin ? `${origin.replace(/\/$/, "")}${path}` : path;
}

/**
 * `buildEmbedIframeUrl("f/aplicacion", {}, {utm_source: "facebook"}, "https://app.x")`
 * → `https://app.x/f/aplicacion?embed=1&utm_source=facebook`
 *
 * Mismo criterio que la Agenda (UTM y ids de clic de la pagina padre, `referrer`),
 * mas: los parametros de la pagina para prellenar (`hostParams`), lo que fija
 * `config.prefill` (gana sobre la URL de la pagina) y `attr`, con las cookies
 * `_fbp`/`_fbc`/`_ga` y la atribucion guardada del sitio que embebe.
 */
function buildFormIframeUrl(calLink: string, config: EmbedConfig, parentUtm: ParentUtm, origin: string | undefined, extras: FormEmbedExtras): string {
  const params = new URLSearchParams();
  params.set("embed", "1");

  // Primero la atribucion, en el orden canonico de las claves.
  const attribution: ParentAttribution = { ...extras.parentAttribution, ...(parentUtm as ParentAttribution) };
  for (const key of TOUCH_KEYS) {
    const v = attribution[key];
    if (v) params.set(key, v);
  }

  // Los parametros de la pagina para prellenar, y encima lo que fija el embed.
  const prefill = (config.prefill && typeof config.prefill === "object" ? config.prefill : {}) as Record<string, unknown>;
  const merged = { ...filterHostParams(extras.hostParams ?? {}), ...filterHostParams(stringify(prefill)) };
  for (const [name, value] of Object.entries(merged)) params.set(name, value);

  if (extras.attr) params.set("attr", extras.attr);

  const referrer = text(config.referrer);
  if (referrer && /^https?:\/\//i.test(referrer)) params.set("referrer", referrer);

  const path = `/f/${calLink.slice(2)}?${params.toString()}`;
  return origin ? `${origin.replace(/\/$/, "")}${path}` : path;
}

function stringify(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    const s = text(v);
    if (s) out[k] = s;
  }
  return out;
}
