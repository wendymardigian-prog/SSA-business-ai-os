// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * Textos de fecha y hora del booker (F25) y de las variables (F47), con
 * `Intl.DateTimeFormat` en español y sin catálogos de idioma extra.
 * Adaptado de `packages/lib/timeFormat.ts` y `Booker/utils/dates.tsx`.
 *
 * Intl mete espacios especiales (U+00A0, U+202F) en "2:00 p. m."; los tests
 * los normalizan con `normalizeSpaces` antes de comparar.
 */
import type { TimeFormat } from "../types";

export const LOCALE = "es";

export function normalizeSpaces(text: string): string {
  return text.replace(/[\u00A0\u202F]/g, " ");
}

function parts(date: Date | string, tz: string, options: Intl.DateTimeFormatOptions): Map<string, string> {
  const list = new Intl.DateTimeFormat(LOCALE, { timeZone: tz, ...options }).formatToParts(new Date(date));
  return new Map(list.map((p) => [p.type, p.value]));
}

/** `2:00 p. m.` en 12h, `14:00` en 24h. */
export function formatSlotLabel(startUtc: Date | string, tz: string, format: TimeFormat): string {
  if (format === "12h") {
    return new Intl.DateTimeFormat(LOCALE, { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(startUtc));
  }
  const p = parts(startUtc, tz, { hour: "2-digit", minute: "2-digit", hour12: false });
  // Algunos runtimes devuelven "24" para la medianoche con hour12: false.
  const hour = String(Number(p.get("hour")) % 24).padStart(2, "0");
  return `${hour}:${p.get("minute")}`;
}

/** `martes 6 de octubre` (minúsculas, como lo pide F47). */
export function formatDateLong(date: Date | string, tz: string): string {
  const p = parts(date, tz, { weekday: "long", day: "numeric", month: "long" });
  return `${p.get("weekday")} ${p.get("day")} de ${p.get("month")}`;
}

/** `martes 6 de octubre de 2026`. */
export function formatDateLongWithYear(date: Date | string, tz: string): string {
  const p = parts(date, tz, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `${p.get("weekday")} ${p.get("day")} de ${p.get("month")} de ${p.get("year")}`;
}

export function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** `14:00 – 14:30` (o `2:00 p. m. – 2:30 p. m.`). */
export function formatTimeRange(startUtc: Date | string, endUtc: Date | string, tz: string, format: TimeFormat): string {
  return `${formatSlotLabel(startUtc, tz, format)} – ${formatSlotLabel(endUtc, tz, format)}`;
}

/** `Martes 6 de octubre, 14:00 – 14:30`: el resumen del formulario del booker. */
export function formatSlotSummary(startUtc: Date | string, endUtc: Date | string, tz: string, format: TimeFormat): string {
  return `${capitalize(formatDateLong(startUtc, tz))}, ${formatTimeRange(startUtc, endUtc, tz, format)}`;
}

/** Ciudades con nombre en español para el "(hora de …)". El resto usa el último tramo de la zona IANA. */
const CITY_LABELS: Record<string, string> = {
  "America/Mexico_City": "Ciudad de México",
  "America/Costa_Rica": "Costa Rica",
  "America/Argentina/Buenos_Aires": "Buenos Aires",
  "America/Bogota": "Bogotá",
  "America/Lima": "Lima",
  "America/Santiago": "Santiago",
  "America/Sao_Paulo": "São Paulo",
  "America/New_York": "Nueva York",
  "America/Los_Angeles": "Los Ángeles",
  "America/Panama": "Panamá",
  "Europe/Madrid": "Madrid",
  UTC: "UTC",
};

export function timezoneCityLabel(tz: string): string {
  return CITY_LABELS[tz] ?? tz.split("/").pop()!.replace(/_/g, " ");
}

/** `martes 6 de octubre, 14:00 (hora de Ciudad de México)` (F47). */
export function formatDateTimeWithZone(date: Date | string, tz: string, format: TimeFormat = "24h"): string {
  return `${formatDateLong(date, tz)}, ${formatSlotLabel(date, tz, format)} (hora de ${timezoneCityLabel(tz)})`;
}

/** `GMT-6`, para el chip de zona de la interfaz. */
export function gmtOffsetLabel(date: Date | string, tz: string): string {
  return parts(date, tz, { timeZoneName: "short" }).get("timeZoneName") ?? tz;
}
