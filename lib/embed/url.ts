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
import { IDENTIFIER_RE } from "@/lib/scheduling/booking-fields";

export const CAL_LINK_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;

/** La configuración que acepta `SSA("inline"|"floatingButton", {config})` y `data-ssa-config`. */
export interface EmbedConfig {
  theme?: BookerTheme | string | null;
  /** Color principal, hex. `brandColor` es el alias que usa `SSA("ui")`. */
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
 * `buildEmbedIframeUrl("wendy/llamada", {theme: "dark", color: "#aa00ff"}, {utm_source: "web"})`
 * → `/calendario/wendy/llamada?embed=1&theme=dark&color=%23aa00ff&utm_source=web`
 *
 * Con `origin` devuelve la URL absoluta. Un color que no es hex se ignora.
 */
export function buildEmbedIframeUrl(calLink: string, config: EmbedConfig = {}, parentUtm: ParentUtm = {}, origin?: string): string {
  if (!CAL_LINK_RE.test(calLink)) throw new Error(`calLink inválido: "${calLink}" (esperado usuario/evento)`);

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

  const referrer = text(config.referrer);
  if (referrer && /^https?:\/\//i.test(referrer)) params.set("referrer", referrer);

  const path = `/calendario/${calLink}?${params.toString()}`;
  return origin ? `${origin.replace(/\/$/, "")}${path}` : path;
}
