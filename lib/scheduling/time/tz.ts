/**
 * Zonas horarias del módulo de agendamiento (F8).
 *
 * Regla del plano: todo instante se guarda en UTC; las reglas se escriben en
 * hora de pared más la zona IANA del horario. Estas funciones son el puente
 * entre las dos cosas y son las únicas que deberían hacer esa conversión.
 *
 * `getViewerTimezone` (la zona de quien mira) lee el perfil y va en la
 * Tanda B; acá solo hay funciones puras que reciben la zona por parámetro.
 */
import dayjs from "./dayjs";
import type { DateString, WallTime } from "../types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;

export type DateInput = Date | string | number;

/**
 * Un instante formateado en la zona pedida, con los tokens de dayjs
 * (`YYYY-MM-DD HH:mm`, `dddd D [de] MMMM`, etc.).
 */
export function formatInTz(date: DateInput, tz: string, format: string): string {
  return dayjs(date).tz(tz).format(format);
}

/** La fecha civil (`YYYY-MM-DD`) que muestra el calendario de la zona en ese instante. */
export function dateInTz(date: DateInput, tz: string): DateString {
  return dayjs(date).tz(tz).format("YYYY-MM-DD");
}

/** Día de la semana (0 = domingo … 6 = sábado) en la zona. */
export function weekdayInTz(date: DateInput, tz: string): number {
  return dayjs(date).tz(tz).day();
}

/** Minutos desde la medianoche local en la zona. */
export function minutesOfDayInTz(date: DateInput, tz: string): number {
  const d = dayjs(date).tz(tz);
  return d.hour() * 60 + d.minute();
}

/** Suma días a una fecha `YYYY-MM-DD` sin pasar por zonas horarias. */
export function addDays(date: DateString, days: number): DateString {
  return dayjs.utc(date).add(days, "day").format("YYYY-MM-DD");
}

/** Verdadero si es una fecha `YYYY-MM-DD` que existe en el calendario. */
export function isValidDateString(value: unknown): value is DateString {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = dayjs.utc(value);
  return d.isValid() && d.format("YYYY-MM-DD") === value;
}

/** Verdadero si es una hora `HH:mm` entre `00:00` y `24:00`. */
export function isValidWallTime(value: unknown): value is WallTime {
  if (typeof value !== "string") return false;
  const m = TIME_RE.exec(value);
  if (!m) return false;
  // 24:xx solo vale como 24:00 (fin del día).
  return m[1] !== "24" || m[2] === "00";
}

/** `"09:30"` → 570. `"24:00"` → 1440. */
export function wallTimeToMinutes(time: WallTime): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** 570 → `"09:30"`. 1440 → `"24:00"`. */
export function minutesToWallTime(minutes: number): WallTime {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Una hora de pared de un día en la zona → el instante UTC.
 *
 * `"24:00"` se interpreta como las 00:00 del día siguiente. Se usa el parser
 * de dayjs.tz, que resuelve el offset del día correcto (incluido el día del
 * cambio de horario de verano).
 */
export function wallClockToUtc(date: DateString, time: WallTime, tz: string): Date {
  if (time === "24:00") {
    return dayjs.tz(`${addDays(date, 1)} 00:00`, tz).toDate();
  }
  return dayjs.tz(`${date} ${time}`, tz).toDate();
}

/** El instante UTC en que empieza el día `date` en la zona. */
export function startOfDayUtc(date: DateString, tz: string): Date {
  return wallClockToUtc(date, "00:00", tz);
}

export interface UtcRange {
  /** ISO UTC, inclusive. */
  fromUtc: string;
  /** ISO UTC, exclusivo. */
  toUtc: string;
}

export type FilterRange = "today" | "this_week" | { from: DateString; to: DateString };

/**
 * Traduce un filtro de fecha de la pantalla de agendas a un rango UTC,
 * cortado en la zona de quien mira. El fin es exclusivo: "hoy" es desde las
 * 00:00 de hoy hasta las 00:00 de mañana, hora local.
 *
 * La semana empieza el lunes (decisión de Wendy).
 *
 * Un rango explícito al revés se da vuelta, como hace `resolveDateRange` en
 * la bandeja: es un error de tipeo, no una búsqueda vacía.
 */
export function rangeForFilter(filter: FilterRange, tz: string, now: Date = new Date()): UtcRange {
  if (filter === "today") {
    const today = dateInTz(now, tz);
    return {
      fromUtc: startOfDayUtc(today, tz).toISOString(),
      toUtc: startOfDayUtc(addDays(today, 1), tz).toISOString(),
    };
  }

  if (filter === "this_week") {
    const today = dateInTz(now, tz);
    const weekday = weekdayInTz(now, tz); // 0 = domingo
    const daysSinceMonday = (weekday + 6) % 7;
    const monday = addDays(today, -daysSinceMonday);
    return {
      fromUtc: startOfDayUtc(monday, tz).toISOString(),
      toUtc: startOfDayUtc(addDays(monday, 7), tz).toISOString(),
    };
  }

  let { from, to } = filter;
  if (!isValidDateString(from) || !isValidDateString(to)) {
    throw new Error("rangeForFilter: las fechas tienen que ser YYYY-MM-DD válidas");
  }
  if (from > to) [from, to] = [to, from];
  return {
    fromUtc: startOfDayUtc(from, tz).toISOString(),
    toUtc: startOfDayUtc(addDays(to, 1), tz).toISOString(),
  };
}

/** Cada fecha `YYYY-MM-DD` entre `from` y `to`, inclusive. */
export function eachDate(from: DateString, to: DateString): DateString[] {
  const out: DateString[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
