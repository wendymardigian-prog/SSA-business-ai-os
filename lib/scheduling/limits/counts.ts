// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * Topes de agendas por día y por semana (F21, F23 paso 7). Adaptado de
 * `packages/lib/intervalLimits/*`: en lugar de consultar la base por cada
 * horario, el motor recibe los conteos ya hechos (`bookingCounts`) en la zona
 * del horario, y acá solo se decide si un horario más superaría el tope.
 *
 * La semana empieza el lunes (decisión de Wendy).
 */
import type { DateString } from "../types";
import { addDays, dateInTz, weekdayInTz } from "../time/tz";

export interface BookingCounts {
  /** Agendas activas por fecha `YYYY-MM-DD` en la zona del horario. */
  byDay: Record<DateString, number>;
  /** Agendas activas por semana, con clave = el lunes de esa semana. */
  byWeek: Record<DateString, number>;
}

export interface CountLimits {
  maxPerDay?: number | null;
  maxPerWeek?: number | null;
}

export function dayKey(instant: Date | string, tz: string): DateString {
  return dateInTz(instant, tz);
}

/** El lunes de la semana del instante, en la zona. */
export function weekKey(instant: Date | string, tz: string): DateString {
  const date = dateInTz(instant, tz);
  const weekday = weekdayInTz(instant, tz);
  return addDays(date, -((weekday + 6) % 7));
}

/** Arma los conteos a partir de las agendas activas del anfitrión para este evento. */
export function countBookings(bookings: { start_at: string }[], tz: string): BookingCounts {
  const counts: BookingCounts = { byDay: {}, byWeek: {} };
  for (const b of bookings) {
    const d = dayKey(b.start_at, tz);
    const w = weekKey(b.start_at, tz);
    counts.byDay[d] = (counts.byDay[d] ?? 0) + 1;
    counts.byWeek[w] = (counts.byWeek[w] ?? 0) + 1;
  }
  return counts;
}

export type LimitReason = "max_per_day" | "max_per_week";

/**
 * Verdadero si agendar en `slotStartUtc` superaría el tope del día o de la
 * semana. Un tope vacío (null, undefined o 0) es "sin tope".
 */
export function exceedsLimits(
  slotStartUtc: Date | string,
  counts: BookingCounts,
  limits: CountLimits,
  tz: string,
): { exceeded: boolean; reason: LimitReason | null } {
  if (limits.maxPerDay && (counts.byDay[dayKey(slotStartUtc, tz)] ?? 0) >= limits.maxPerDay) {
    return { exceeded: true, reason: "max_per_day" };
  }
  if (limits.maxPerWeek && (counts.byWeek[weekKey(slotStartUtc, tz)] ?? 0) >= limits.maxPerWeek) {
    return { exceeded: true, reason: "max_per_week" };
  }
  return { exceeded: false, reason: null };
}
