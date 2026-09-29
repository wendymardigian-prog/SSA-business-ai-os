/**
 * El popover de período: los atajos, el calendario de dos meses y el rango
 * personalizado.
 *
 * Reglas:
 *
 *   - **Los días se cortan en la zona del negocio**, no en la del navegador. Un
 *     "hoy" que cambie segun donde esta parado quien mira no sirve para nada.
 *   - **No hay dias futuros.** No hay datos del futuro, y un rango que termina
 *     manana muestra lo mismo que uno que termina hoy con una fecha que miente.
 *   - **El rango se puede elegir en cualquier orden**: si el segundo clic cae
 *     antes del primero, se da vuelta.
 *   - La semana arranca el lunes.
 */

import { civilDate, endOfDay, startOfDay } from "@/lib/dates";

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export interface CivilRange {
  from: CivilDate;
  /** null mientras se esta eligiendo el segundo extremo. */
  to: CivilDate | null;
}

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/** Los dias de la semana como los muestra el calendario, de lunes a domingo. */
export const WEEKDAYS_SHORT = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

/** Una fecha civil como clave ISO (YYYY-MM-DD). */
export function toKey(c: CivilDate): string {
  return `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
}

export function fromKey(key: string): CivilDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Un 31 de febrero no existe: se compara contra el calendario real.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Compara dos fechas civiles: negativo si a es antes. */
export function compareCivil(a: CivilDate, b: CivilDate): number {
  return toKey(a).localeCompare(toKey(b));
}

export function sameCivil(a: CivilDate | null, b: CivilDate | null): boolean {
  return Boolean(a && b && compareCivil(a, b) === 0);
}

/** Suma dias sobre el calendario (sobrevive al cambio de hora y al fin de mes). */
export function addDays(c: CivilDate, delta: number): CivilDate {
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 0 = domingo … 6 = sabado. */
function weekday(c: CivilDate): number {
  return new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay();
}

/** El lunes de la semana de esa fecha. */
export function mondayOfCivil(c: CivilDate): CivilDate {
  const dow = weekday(c);
  return addDays(c, -(dow === 0 ? 6 : dow - 1));
}

/** Hoy, en la zona del negocio. */
export function todayIn(timeZone: string, now: Date = new Date()): CivilDate {
  return civilDate(now, timeZone);
}

export interface CalendarCell {
  date: CivilDate;
  key: string;
  /** Si cae en el mes que se esta mostrando (si no, se ve apagada). */
  inMonth: boolean;
  /** Los dias futuros no se pueden elegir. */
  isFuture: boolean;
  isToday: boolean;
}

/**
 * La grilla de un mes: seis semanas de lunes a domingo, con los dias del mes
 * anterior y del siguiente para completar.
 */
export function monthGrid(year: number, month: number, today: CivilDate): CalendarCell[] {
  const first: CivilDate = { year, month, day: 1 };
  const start = mondayOfCivil(first);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    cells.push({
      date,
      key: toKey(date),
      inMonth: date.month === month && date.year === year,
      isFuture: compareCivil(date, today) > 0,
      isToday: sameCivil(date, today),
    });
  }
  return cells;
}

/** El mes anterior, para el calendario de la izquierda. */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/**
 * El clic siguiente sobre el calendario.
 *
 * Con un rango completo, empieza uno nuevo. Con solo el arranque elegido, cierra
 * el rango, dandolo vuelta si hace falta.
 */
export function pickDay(current: CivilRange | null, day: CivilDate): CivilRange {
  if (!current || current.to !== null) return { from: day, to: null };
  return compareCivil(day, current.from) < 0 ? { from: day, to: current.from } : { from: current.from, to: day };
}

/** El rango listo para la URL: instantes UTC del principio y del fin del dia. */
export function civilRangeToIso(range: { from: CivilDate; to: CivilDate }, timeZone: string): { from: string; to: string } {
  const [a, b] = compareCivil(range.from, range.to) <= 0 ? [range.from, range.to] : [range.to, range.from];
  return {
    from: startOfDay(a.year, a.month, a.day, timeZone).toISOString(),
    to: endOfDay(b.year, b.month, b.day, timeZone).toISOString(),
  };
}

/** Lo que vino de la URL, como fechas del calendario. Invalido = null. */
export function isoRangeToCivil(
  from: string | null,
  to: string | null,
  timeZone: string,
): { from: CivilDate; to: CivilDate } | null {
  if (!from || !to) return null;
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return { from: civilDate(a, timeZone), to: civilDate(b, timeZone) };
}

/** "25 sept 2026" */
export function formatCivil(c: CivilDate): string {
  return `${String(c.day).padStart(2, "0")} ${MONTHS_SHORT[c.month - 1]} ${c.year}`;
}

/** "25 sept" (sin año, para el boton) */
export function formatCivilShort(c: CivilDate): string {
  return `${c.day} ${MONTHS_SHORT[c.month - 1]}`;
}

/** "Septiembre 2026", para el encabezado del calendario. */
export function formatMonth(year: number, month: number): string {
  const name = MONTHS[month - 1];
  return `${name[0].toUpperCase()}${name.slice(1)} ${year}`;
}

/** El texto del rango elegido, o el aviso de que falta el fin. */
export function formatRange(range: CivilRange | null): string {
  if (!range) return "Elegí un día";
  if (!range.to) return `${formatCivil(range.from)} – elegí el fin`;
  if (sameCivil(range.from, range.to)) return formatCivil(range.from);
  return `${formatCivil(range.from)} – ${formatCivil(range.to)}`;
}

/** Lo que dice el boton de período: el nombre del atajo, o el rango corto. */
export function periodButtonLabel(
  presetLabel: string | null,
  civil: { from: CivilDate; to: CivilDate } | null,
): string {
  if (presetLabel) return presetLabel;
  if (!civil) return "Período";
  if (sameCivil(civil.from, civil.to)) return formatCivilShort(civil.from);
  return `${formatCivilShort(civil.from)} – ${formatCivilShort(civil.to)}`;
}
