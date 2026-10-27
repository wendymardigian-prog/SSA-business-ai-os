/**
 * Fechas civiles de Finanzas. Una fecha civil es un texto `AAAA-MM-DD` en la zona del workspace: no tiene
 * hora ni zona, y toda la aritmética es en UTC sobre el calendario. Así ninguna zona del servidor se cuela
 * (uno de los bugs de prevxcrm era `new Date(año, mes, día)` con la hora local del proceso).
 *
 * "Hoy" siempre lo resuelve quien llama con `localToday(now, workspace.timezone)`.
 */
export { addDays, addMonths, daysBetween, isDateOnly, localDate, localToday } from "@/lib/shared/dates";

export type CivilDate = string;

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Último día del mes (`month` de 1 a 12). */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function compareCivil(a: CivilDate, b: CivilDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `2026-10-15` → `2026-10`. */
export function monthKey(date: CivilDate): string {
  return date.slice(0, 7);
}

/** `2026-10` → `2026-10-01`. */
export function monthStart(key: string): CivilDate {
  return `${key}-01`;
}

/** `2026-10` → `2026-10-31`. */
export function monthEnd(key: string): CivilDate {
  const [y, m] = key.split("-").map(Number);
  return `${key}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}`;
}

/** `2026-10` → `2026-11`. */
export function nextMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** `2026-10` → `2026-09`. */
export function previousMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** `2026-10` → `octubre 2026`. */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1] ?? key} ${y}`;
}

/** Día de la semana de una fecha civil: 0 = domingo … 6 = sábado. */
export function weekdayOf(date: CivilDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** El lunes de la semana de esa fecha (la semana va de lunes a domingo). */
export function weekStart(date: CivilDate): CivilDate {
  const back = (weekdayOf(date) + 6) % 7;
  return addDaysLocal(date, -back);
}

/** El domingo de la semana de esa fecha. */
export function weekEnd(date: CivilDate): CivilDate {
  return addDaysLocal(weekStart(date), 6);
}

function addDaysLocal(date: CivilDate, days: number): CivilDate {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
