/**
 * Lo ocupado que se resta a las ventanas (F23, pasos 2 a 4).
 *
 * - Tiempo fuera: tal cual.
 * - Ocupado de Google: agrandado con los buffers del evento NUEVO (un evento
 *   con 15 min de buffer después no puede terminar pegado a una reunión de
 *   Google).
 * - Agendas del sistema: agrandadas con los buffers de SU evento y con los
 *   del evento nuevo. Así, una agenda de 10:00 a 10:30 con 15 min después no
 *   deja agendar a las 10:30 aunque el evento nuevo no tenga buffers.
 */
import type { UtcInterval } from "../types";
import { mergeOverlapping, type Range } from "./date-ranges";

const MIN = 60_000;

/** Una agenda activa del anfitrión, con los buffers del evento al que pertenece. */
export interface SystemBooking {
  start_at: string;
  end_at: string;
  before_buffer_minutes?: number | null;
  after_buffer_minutes?: number | null;
}

export interface BusyInput {
  outOfOffice?: { starts_at: string; ends_at: string }[];
  busy?: UtcInterval[];
  bookings?: SystemBooking[];
  /** Buffers del evento que se está agendando. */
  newBeforeMinutes: number;
  newAfterMinutes: number;
}

export function busyRanges(input: BusyInput): Range[] {
  const before = Math.max(0, input.newBeforeMinutes) * MIN;
  const after = Math.max(0, input.newAfterMinutes) * MIN;
  const out: Range[] = [];

  for (const o of input.outOfOffice ?? []) {
    out.push({ start: Date.parse(o.starts_at), end: Date.parse(o.ends_at) });
  }

  for (const b of input.busy ?? []) {
    out.push({ start: Date.parse(b.startUtc) - after, end: Date.parse(b.endUtc) + before });
  }

  for (const b of input.bookings ?? []) {
    const ownBefore = Math.max(0, b.before_buffer_minutes ?? 0) * MIN;
    const ownAfter = Math.max(0, b.after_buffer_minutes ?? 0) * MIN;
    out.push({
      start: Date.parse(b.start_at) - ownBefore - after,
      end: Date.parse(b.end_at) + ownAfter + before,
    });
  }

  return mergeOverlapping(out.filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start));
}
