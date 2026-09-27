// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * Ventanas de disponibilidad por día (F23, pasos 1 y 2). Adaptado de
 * `packages/features/schedules/lib/date-ranges.ts`: se quitan Prisma, los
 * "travel schedules" y el modelo de filas `Availability`; las reglas llegan
 * como `weekly_hours` y `date_overrides` (jsonb del horario).
 *
 * Todo se calcula en milisegundos de época (UTC). Un rango es `[start, end)`.
 */
import type { AvailabilitySchedule, DateOverride, DateString, TimeRange, WeekdayKey } from "../types";
import { addDays, dateInTz, eachDate, wallClockToUtc, weekdayInTz } from "../time/tz";

export interface Range {
  start: number;
  end: number;
}

export type ScheduleRules = Pick<AvailabilitySchedule, "timezone" | "weekly_hours" | "date_overrides">;

/** Los rangos de hora de pared de una fecha: la excepción del día, o la regla semanal. */
export function rangesForDate(schedule: ScheduleRules, date: DateString, overrides?: DateOverride[]): TimeRange[] {
  const override = (overrides ?? schedule.date_overrides ?? []).find((o) => o.date === date);
  if (override) return override.ranges;
  const weekday = String(weekdayInTz(`${date}T12:00:00Z`, "UTC")) as WeekdayKey;
  return schedule.weekly_hours?.[weekday] ?? [];
}

/**
 * Las ventanas UTC de cada fecha entre `fromDate` y `toDate` (fechas en la
 * zona del horario), ya fusionadas si se tocan. Con esto un horario de 20:00
 * a 24:00 seguido de 00:00 a 02:00 del día siguiente queda como una sola
 * ventana continua.
 */
export function dailyWindows(
  schedule: ScheduleRules,
  fromDate: DateString,
  toDate: DateString,
  overrides?: DateOverride[],
): Range[] {
  const out: Range[] = [];
  for (const date of eachDate(fromDate, toDate)) {
    for (const r of rangesForDate(schedule, date, overrides)) {
      const start = wallClockToUtc(date, r.start, schedule.timezone).getTime();
      const end = wallClockToUtc(date, r.end, schedule.timezone).getTime();
      if (end > start) out.push({ start, end });
    }
  }
  return mergeOverlapping(out);
}

/** Las fechas (en la zona del horario) que hay que mirar para cubrir un rango UTC, con un día de margen a cada lado. */
export function datesCovering(fromUtc: number, toUtc: number, tz: string): { fromDate: DateString; toDate: DateString } {
  return {
    fromDate: addDays(dateInTz(fromUtc, tz), -1),
    toDate: addDays(dateInTz(toUtc, tz), 1),
  };
}

/** Une rangos que se superponen o se tocan. Devuelve una lista ordenada. */
export function mergeOverlapping(ranges: Range[]): Range[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Range[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else merged.push({ ...cur });
  }
  return merged;
}

/** Recorta cada rango a `[from, to)` y descarta los que quedan vacíos. */
export function clipRanges(ranges: Range[], from: number, to: number): Range[] {
  const out: Range[] = [];
  for (const r of ranges) {
    const start = Math.max(r.start, from);
    const end = Math.min(r.end, to);
    if (end > start) out.push({ start, end });
  }
  return out;
}

/** Resta los rangos excluidos de los rangos fuente. No exige orden en ninguno de los dos. */
export function subtractRanges(source: Range[], excluded: Range[]): Range[] {
  const result: Range[] = [];
  const sortedExcluded = [...excluded].sort((a, b) => a.start - b.start);

  for (const { start: sourceStart, end: sourceEnd } of source) {
    let currentStart = sourceStart;
    for (const ex of sortedExcluded) {
      if (ex.start >= sourceEnd) break;
      if (ex.end <= currentStart) continue;
      if (ex.start > currentStart) result.push({ start: currentStart, end: ex.start });
      if (ex.end > currentStart) currentStart = ex.end;
    }
    if (sourceEnd > currentStart) result.push({ start: currentStart, end: sourceEnd });
  }
  return result;
}

/**
 * Intersección de varias listas de rangos (lo que tienen libre todos a la
 * vez). Hoy el evento es individual; queda para los eventos de equipo de la
 * Fase 3.
 */
export function intersectRanges(lists: Range[][]): Range[] {
  if (lists.length === 0) return [];
  let common = [...lists[0]].sort((a, b) => a.start - b.start);
  for (let i = 1; i < lists.length; i++) {
    if (common.length === 0) return [];
    const other = [...lists[i]].sort((a, b) => a.start - b.start);
    const next: Range[] = [];
    let a = 0;
    let b = 0;
    while (a < common.length && b < other.length) {
      const start = Math.max(common[a].start, other[b].start);
      const end = Math.min(common[a].end, other[b].end);
      if (start < end) next.push({ start, end });
      if (common[a].end <= other[b].end) a++;
      else b++;
    }
    common = next;
  }
  return common;
}

export function toRange(interval: { startUtc: string; endUtc: string }): Range {
  return { start: new Date(interval.startUtc).getTime(), end: new Date(interval.endUtc).getTime() };
}
