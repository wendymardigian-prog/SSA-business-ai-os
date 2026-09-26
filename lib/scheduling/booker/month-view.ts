/**
 * Calendario del mes del booker (F25): qué días tienen horarios y a qué mes
 * saltar si este no tiene ninguno.
 */
import type { SlotsByDate, DateString } from "../types";
import { addDays, dateInTz, weekdayInTz } from "../time/tz";

export type MonthString = string; // YYYY-MM

export interface MonthDay {
  date: DateString;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  available: boolean;
  slotCount: number;
}

export interface MonthView {
  month: MonthString;
  /** Semanas de lunes a domingo, con los días de relleno del mes anterior y siguiente. */
  weeks: MonthDay[][];
  availableDates: DateString[];
  hasAnySlots: boolean;
  /** El primer mes posterior con al menos un horario, o null. */
  nextMonthWithSlots: MonthString | null;
  /** El último mes anterior con al menos un horario, o null. */
  prevMonthWithSlots: MonthString | null;
}

export function monthOf(date: DateString): MonthString {
  return date.slice(0, 7);
}

export function addMonths(month: MonthString, n: number): MonthString {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: MonthString): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function weekdayOfDate(date: DateString): number {
  return weekdayInTz(`${date}T12:00:00Z`, "UTC");
}

export function buildMonthView(slotsByDate: SlotsByDate, month: MonthString, tz: string, now: Date = new Date()): MonthView {
  const today = dateInTz(now, tz);
  const first = `${month}-01`;
  const last = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;

  // Empieza el lunes en o antes del 1 y termina el domingo en o después del último día.
  let cursor = addDays(first, -((weekdayOfDate(first) + 6) % 7));
  const end = addDays(last, (7 - weekdayOfDate(last)) % 7);

  const weeks: MonthDay[][] = [];
  let week: MonthDay[] = [];
  while (cursor <= end) {
    const slotCount = slotsByDate[cursor]?.length ?? 0;
    week.push({
      date: cursor,
      dayOfMonth: Number(cursor.slice(8, 10)),
      isCurrentMonth: monthOf(cursor) === month,
      isToday: cursor === today,
      available: slotCount > 0,
      slotCount,
    });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
    cursor = addDays(cursor, 1);
  }

  const datesWithSlots = Object.keys(slotsByDate)
    .filter((d) => (slotsByDate[d]?.length ?? 0) > 0)
    .sort();
  const availableDates = datesWithSlots.filter((d) => monthOf(d) === month);
  const next = datesWithSlots.find((d) => d > last);
  const prev = [...datesWithSlots].reverse().find((d) => d < first);

  return {
    month,
    weeks,
    availableDates,
    hasAnySlots: availableDates.length > 0,
    nextMonthWithSlots: next ? monthOf(next) : null,
    prevMonthWithSlots: prev ? monthOf(prev) : null,
  };
}

/** El primer mes con horarios en toda la respuesta, o null si no hay ninguno (F58: `no_slots`). */
export function firstMonthWithSlots(slotsByDate: SlotsByDate): MonthString | null {
  const first = Object.keys(slotsByDate)
    .filter((d) => (slotsByDate[d]?.length ?? 0) > 0)
    .sort()[0];
  return first ? monthOf(first) : null;
}
