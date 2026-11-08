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
 * - Espacios liberados: dentro del rango de una reunión con «Liberar espacio»
 *   (o de la que se está reagendando) el ocupado de Google NO cuenta. Google
 *   no dice de qué evento es cada ocupado, y el evento de esa reunión puede
 *   seguir figurando (el job que lo pone «libre» todavía no corrió, falló, o
 *   es la copia del anfitrión nuevo después de reasignar). Es la doble reserva
 *   a propósito: liberar es justamente permitir agendar encima.
 */
import type { UtcInterval } from "../types";
import { mergeOverlapping, subtractRanges, type Range } from "./date-ranges";

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
  /** Rangos donde el ocupado de Google no cuenta (reuniones liberadas, la que se reagenda). */
  freed?: { start_at: string; end_at: string }[];
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

  const google = (input.busy ?? []).map((b) => ({ start: Date.parse(b.startUtc), end: Date.parse(b.endUtc) }));
  const freed = (input.freed ?? [])
    .map((f) => ({ start: Date.parse(f.start_at), end: Date.parse(f.end_at) }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);
  for (const g of freed.length > 0 ? subtractRanges(google, freed) : google) {
    out.push({ start: g.start - after, end: g.end + before });
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
