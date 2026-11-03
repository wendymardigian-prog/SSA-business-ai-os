/**
 * Los filtros de fecha de la lista de contactos: un solo parámetro de la URL
 * por filtro, con un atajo ("7d", "vencido"…) o un rango entre dos días
 * ("2026-10-01..2026-10-31", con cualquiera de las dos puntas vacía).
 *
 * Puro. Los días se cuentan en la zona de quien mira (`user_preferences`): "hoy"
 * para una persona en Costa Rica no es el "hoy" de otra en España.
 */
import { civilDate, endOfDay, startOfDay } from "@/lib/dates";

/** Los atajos. Cada filtro elige cuáles ofrece. */
export const DATE_PRESETS = ["hoy", "ayer", "7d", "30d", "90d", "proximos7", "vencido", "sin", "con", "proximas", "pasadas"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  hoy: "Hoy",
  ayer: "Ayer",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
  proximos7: "Próximos 7 días",
  vencido: "Vencido",
  sin: "Sin fecha",
  con: "Con fecha",
  proximas: "Próximas",
  pasadas: "Pasadas",
};

/** Lo que mira para atrás (creado, última interacción). */
export const PAST_PRESETS: readonly DatePreset[] = ["hoy", "ayer", "7d", "30d", "90d"];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validDay(raw: string): boolean {
  if (!DAY.test(raw)) return false;
  const [y, m, d] = raw.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export type DateValue = { preset: DatePreset } | { from: string | null; to: string | null };

/** Lee el valor. Un rango sin ninguna punta, o un atajo que este filtro no ofrece, no vale. */
export function parseDateValue(raw: string, presets: readonly DatePreset[]): DateValue | null {
  const value = raw.trim();
  if ((presets as readonly string[]).includes(value)) return { preset: value as DatePreset };
  const parts = value.split("..");
  if (parts.length !== 2) return null;
  const [from, to] = parts.map((p) => p.trim());
  if (!from && !to) return null;
  if ((from && !validDay(from)) || (to && !validDay(to))) return null;
  // Al revés es un error de tipeo, no una búsqueda vacía.
  if (from && to && from > to) return { from: to, to: from };
  return { from: from || null, to: to || null };
}

/** El valor de la URL para un rango. */
export function formatDateRange(from: string, to: string): string {
  return `${from}..${to}`;
}

/** Lo que se ve en el chip. */
export function describeDateValue(raw: string, presets: readonly DatePreset[]): string {
  const v = parseDateValue(raw, presets);
  if (!v) return raw;
  if ("preset" in v) return DATE_PRESET_LABELS[v.preset];
  const show = (d: string) => d.split("-").reverse().join("/");
  if (v.from && v.to) return v.from === v.to ? show(v.from) : `${show(v.from)} – ${show(v.to)}`;
  if (v.from) return `Desde el ${show(v.from)}`;
  return `Hasta el ${show(v.to as string)}`;
}

/** Las condiciones de una fecha: instantes ISO (columna timestamptz), o vacío / no vacío. */
export interface DateBounds {
  gte?: string;
  lte?: string;
  lt?: string;
  isNull?: boolean;
  notNull?: boolean;
}

function shift(base: { year: number; month: number; day: number }, days: number) {
  const d = new Date(Date.UTC(base.year, base.month - 1, base.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
const startIso = (c: { year: number; month: number; day: number }, tz: string) => startOfDay(c.year, c.month, c.day, tz).toISOString();
const endIso = (c: { year: number; month: number; day: number }, tz: string) => endOfDay(c.year, c.month, c.day, tz).toISOString();
const civil = (day: string) => {
  const [year, month, d] = day.split("-").map(Number);
  return { year, month, day: d };
};

/**
 * El rango de instantes. Los atajos para atrás no tienen techo a propósito
 * (como en la bandeja): un contacto que entra mientras se mira no se esconde.
 */
export function dateBounds(value: DateValue, now: Date, timeZone: string): DateBounds {
  if (!("preset" in value)) {
    return {
      ...(value.from ? { gte: startIso(civil(value.from), timeZone) } : {}),
      ...(value.to ? { lte: endIso(civil(value.to), timeZone) } : {}),
    };
  }
  const today = civilDate(now, timeZone);
  switch (value.preset) {
    case "hoy":
      return { gte: startIso(today, timeZone), lte: endIso(today, timeZone) };
    case "ayer": {
      const y = shift(today, -1);
      return { gte: startIso(y, timeZone), lte: endIso(y, timeZone) };
    }
    case "7d":
      return { gte: startIso(shift(today, -6), timeZone) };
    case "30d":
      return { gte: startIso(shift(today, -29), timeZone) };
    case "90d":
      return { gte: startIso(shift(today, -89), timeZone) };
    case "proximos7":
      return { gte: startIso(today, timeZone), lte: endIso(shift(today, 6), timeZone) };
    case "vencido":
      return { lt: startIso(today, timeZone) };
    case "sin":
      return { isNull: true };
    case "con":
      return { notNull: true };
    case "proximas":
      return { gte: now.toISOString() };
    case "pasadas":
      return { lt: now.toISOString() };
  }
}
