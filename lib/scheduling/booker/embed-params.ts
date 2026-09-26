// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * Parámetros de la URL del booker (F25, F29, F39): tema, color, precarga,
 * UTM y modo embed, validados. Adaptado de `Booker/utils/query-param.ts` y
 * de la lectura de config del embed de Cal.diy.
 *
 * Todo lo que llega por la URL es entrada no confiable: valores fuera de
 * lista se ignoran y los textos se recortan.
 */
import { IDENTIFIER_RE } from "../booking-fields";
import { isValidDateString } from "../time/tz";
import { isValidTimeZone } from "@/lib/timezone";

export type BookerTheme = "light" | "dark" | "auto";
export const BOOKER_THEMES: BookerTheme[] = ["light", "dark", "auto"];

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export const CLICK_ID_KEYS = ["fbclid", "gclid"] as const;
export type ClickIdKey = (typeof CLICK_ID_KEYS)[number];

export const HEX_COLOR_RE = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

const MAX_TEXT = 500;

/** Claves con significado propio: no se leen como precarga de preguntas. */
export const RESERVED_PARAMS = new Set<string>([
  "embed",
  "theme",
  "color",
  "layout",
  "hideEventTypeDetails",
  "tz",
  "timezone",
  "date",
  "month",
  "slot",
  "rescheduleUid",
  "website",
  ...UTM_KEYS,
  ...CLICK_ID_KEYS,
]);

export interface EmbedParams {
  embed: boolean;
  theme: BookerTheme;
  /** `#rrggbb` en minúsculas, o null si no vino o no es válido. */
  color: string | null;
  hideEventTypeDetails: boolean;
  timezone: string | null;
  date: string | null;
  month: string | null;
  prefill: {
    name?: string;
    email?: string;
    phone?: string;
    /** Otras preguntas por identificador. */
    answers: Record<string, string>;
  };
  utm: Partial<Record<UtmKey, string>>;
  clickIds: Partial<Record<ClickIdKey, string>>;
}

export type ParamsSource = URLSearchParams | Record<string, string | string[] | undefined>;

function first(source: ParamsSource, key: string): string | null {
  const raw = source instanceof URLSearchParams ? source.get(key) : source[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT) : null;
}

function keys(source: ParamsSource): string[] {
  return source instanceof URLSearchParams ? [...new Set(source.keys())] : Object.keys(source);
}

/** `#AA00FF` o `aa00ff` → `#aa00ff`; `abc` → `#aabbcc`; inválido → null. */
export function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = HEX_COLOR_RE.exec(value.trim());
  if (!m) return null;
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  return `#${hex}`;
}

export function isTruthyParam(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export function parseEmbedParams(source: ParamsSource): EmbedParams {
  const themeRaw = first(source, "theme");
  const theme = (BOOKER_THEMES as string[]).includes(themeRaw ?? "") ? (themeRaw as BookerTheme) : "auto";

  const tzRaw = first(source, "tz") ?? first(source, "timezone");
  const timezone = tzRaw && isValidTimeZone(tzRaw) ? tzRaw : null;

  const dateRaw = first(source, "date");
  const monthRaw = first(source, "month");

  const utm: Partial<Record<UtmKey, string>> = {};
  for (const k of UTM_KEYS) {
    const v = first(source, k);
    if (v) utm[k] = v;
  }
  const clickIds: Partial<Record<ClickIdKey, string>> = {};
  for (const k of CLICK_ID_KEYS) {
    const v = first(source, k);
    if (v) clickIds[k] = v;
  }

  const answers: Record<string, string> = {};
  for (const k of keys(source)) {
    if (RESERVED_PARAMS.has(k) || k === "name" || k === "email" || k === "phone") continue;
    if (!IDENTIFIER_RE.test(k)) continue;
    const v = first(source, k);
    if (v) answers[k] = v;
  }

  const prefill: EmbedParams["prefill"] = { answers };
  const name = first(source, "name");
  const email = first(source, "email");
  const phone = first(source, "phone");
  if (name) prefill.name = name;
  if (email) prefill.email = email;
  if (phone) prefill.phone = phone;

  return {
    embed: isTruthyParam(first(source, "embed")),
    theme,
    color: normalizeHexColor(first(source, "color")),
    hideEventTypeDetails: isTruthyParam(first(source, "hideEventTypeDetails")),
    timezone,
    date: dateRaw && isValidDateString(dateRaw) ? dateRaw : null,
    month: monthRaw && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthRaw) ? monthRaw : null,
    prefill,
    utm,
    clickIds,
  };
}
