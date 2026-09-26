/**
 * Motor de horarios libres (F23). Puro: sin base ni red. La Tanda B arma la
 * entrada (evento, horario, tiempo fuera, ocupado de Google, agendas del
 * sistema y conteos) y le pasa `now`.
 *
 * Pasos, en el orden del plano:
 * 1. Ventanas por día en la zona del horario (reglas semanales, reemplazadas
 *    por la excepción del día).
 * 2. Resta el tiempo fuera.
 * 3. Resta el ocupado de Google.
 * 4. Resta las agendas del sistema con los buffers de las dos agendas.
 * 5. Parte en horarios según el intervalo.
 * 6. Descarta los que no entran completos.
 * 7. Aplica aviso mínimo, ventana futura y topes por día y semana.
 * 8. Agrupa por fecha en la zona del invitado.
 */
import type { AvailabilitySchedule, DateOverride, EventType, Slot, SlotsByDate, UtcInterval } from "../types";
import { dateInTz } from "../time/tz";
import { effectiveSlotInterval } from "../limits/buffers";
import { isOutOfBounds } from "../limits/period";
import { exceedsLimits, type BookingCounts } from "../limits/counts";
import { clipRanges, dailyWindows, datesCovering, subtractRanges, type Range } from "./date-ranges";
import { busyRanges, type SystemBooking } from "./busy";
import { splitIntoSlots } from "./slots";

export type SlotsEventType = Pick<
  EventType,
  | "duration_minutes"
  | "slot_interval_minutes"
  | "before_buffer_minutes"
  | "after_buffer_minutes"
  | "minimum_notice_minutes"
  | "period_type"
  | "period_days"
  | "period_start_date"
  | "period_end_date"
  | "max_per_day"
  | "max_per_week"
>;

export interface SlotsInput {
  eventType: SlotsEventType;
  schedule: Pick<AvailabilitySchedule, "timezone" | "weekly_hours" | "date_overrides">;
  /** Si se pasa, reemplaza `schedule.date_overrides`. */
  overrides?: DateOverride[];
  outOfOffice?: { starts_at: string; ends_at: string }[];
  /** Ocupado de Google, en UTC. */
  busy?: UtcInterval[];
  /** Agendas activas del anfitrión (de cualquier evento), con los buffers de su evento. */
  bookings?: SystemBooking[];
  /** Conteos de agendas de ESTE evento por día y semana, en la zona del horario. */
  bookingCounts?: BookingCounts;
  now: Date | string;
  /** Rango consultado, ISO UTC, fin exclusivo. */
  range: { from: string; to: string };
  /** Zona del invitado, para agrupar. */
  inviteeTz: string;
  /**
   * Si es verdadero, no se aplica el aviso mínimo (F37: "Ignorar el aviso
   * mínimo · solo para el equipo"). Lo pasado y lo ocupado siguen bloqueados.
   */
  ignoreMinimumNotice?: boolean;
}

/** Las ventanas libres (pasos 1 a 4), en ms. Útil para la vista previa (F15) y para depurar. */
export function freeWindows(input: SlotsInput): Range[] {
  const from = Date.parse(input.range.from);
  const to = Date.parse(input.range.to);
  const now = new Date(input.now).getTime();
  const tz = input.schedule.timezone;

  const { fromDate, toDate } = datesCovering(from, to, tz);
  const windows = clipRanges(dailyWindows(input.schedule, fromDate, toDate, input.overrides), Math.max(from, now), to);

  const busy = busyRanges({
    outOfOffice: input.outOfOffice,
    busy: input.busy,
    bookings: input.bookings,
    newBeforeMinutes: input.eventType.before_buffer_minutes ?? 0,
    newAfterMinutes: input.eventType.after_buffer_minutes ?? 0,
  });

  return subtractRanges(windows, busy);
}

/** Los horarios como lista plana, ya filtrados (pasos 1 a 7). */
export function availableSlots(input: SlotsInput): Slot[] {
  const tz = input.schedule.timezone;
  const now = new Date(input.now);
  const e = input.eventType;

  const slots = splitIntoSlots(freeWindows(input), {
    durationMinutes: e.duration_minutes,
    intervalMinutes: effectiveSlotInterval(e.duration_minutes, e.slot_interval_minutes),
    tz,
  });

  const bounds = {
    periodType: e.period_type,
    periodDays: e.period_days,
    periodStartDate: e.period_start_date,
    periodEndDate: e.period_end_date,
    minimumNoticeMinutes: input.ignoreMinimumNotice ? 0 : e.minimum_notice_minutes,
  };
  const limits = { maxPerDay: e.max_per_day, maxPerWeek: e.max_per_week };
  const counts = input.bookingCounts ?? { byDay: {}, byWeek: {} };

  return slots.filter(
    (s) => !isOutOfBounds(s.startUtc, bounds, now, tz).out && !exceedsLimits(s.startUtc, counts, limits, tz).exceeded,
  );
}

/** Salida del motor: `{ [fecha en la zona del invitado]: [{ startUtc, endUtc }] }`, con las fechas ordenadas. */
export function getAvailableSlots(input: SlotsInput): SlotsByDate {
  const byDate: SlotsByDate = {};
  for (const slot of availableSlots(input)) {
    const key = dateInTz(slot.startUtc, input.inviteeTz);
    (byDate[key] ??= []).push(slot);
  }
  return Object.fromEntries(Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)));
}

/** Verdadero si `startUtc` es exactamente uno de los horarios del motor (F26: el servidor decide). */
export function isSlotAvailable(input: SlotsInput, startUtc: string): boolean {
  const wanted = new Date(startUtc).getTime();
  return availableSlots(input).some((s) => Date.parse(s.startUtc) === wanted);
}

export type { Range } from "./date-ranges";
export type { SystemBooking } from "./busy";
export { dailyWindows, subtractRanges, mergeOverlapping, intersectRanges, clipRanges } from "./date-ranges";
export { busyRanges } from "./busy";
export { splitIntoSlots, alignUp, alignmentUnit } from "./slots";
