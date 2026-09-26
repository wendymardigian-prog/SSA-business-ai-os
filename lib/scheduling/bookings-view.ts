/**
 * Funciones puras de la pantalla de agendas (F32, F33). `filterBookings`
 * (arma la consulta con el alcance) va en la Tanda B.
 */
import type { Booking, BookingStatus } from "./types";
import { BOOKING_STATUS_KEYS, groupOf, isActive, canTransition } from "./booking-status";

/** "Sin resultado": estado activo y el fin ya pasó. Es calculado, no se guarda. */
export function needsOutcome(booking: Pick<Booking, "status" | "end_at">, now: Date): boolean {
  return isActive(booking.status) && Date.parse(booking.end_at) <= now.getTime();
}

export type QuickFilter = "upcoming" | "needs_outcome" | "with_outcome" | "cancelled";

export const QUICK_FILTER_LABELS: Record<QuickFilter, string> = {
  upcoming: "Próximas",
  needs_outcome: "Sin resultado",
  with_outcome: "Con resultado",
  cancelled: "Canceladas",
};

/** A qué filtro rápido pertenece una agenda (F33: pastillas con contador). */
export function quickFilterOf(booking: Pick<Booking, "status" | "start_at" | "end_at">, now: Date): QuickFilter {
  const group = groupOf(booking.status);
  if (group === "cancelled") return "cancelled";
  if (group === "no_show" || group === "outcome") return "with_outcome";
  return needsOutcome(booking, now) ? "needs_outcome" : "upcoming";
}

/**
 * Aplica un filtro rápido en memoria y ordena como pide F33: próximas
 * ascendente, el resto descendente.
 */
export function applyQuickFilter<T extends Pick<Booking, "status" | "start_at" | "end_at">>(
  bookings: T[],
  filter: QuickFilter,
  now: Date,
): T[] {
  const dir = filter === "upcoming" ? 1 : -1;
  return bookings
    .filter((b) => quickFilterOf(b, now) === filter)
    .sort((a, b) => dir * (Date.parse(a.start_at) - Date.parse(b.start_at)));
}

export function quickFilterCounts(bookings: Pick<Booking, "status" | "start_at" | "end_at">[], now: Date): Record<QuickFilter, number> {
  const counts: Record<QuickFilter, number> = { upcoming: 0, needs_outcome: 0, with_outcome: 0, cancelled: 0 };
  for (const b of bookings) counts[quickFilterOf(b, now)]++;
  return counts;
}

/** Una columna por estado, en el orden del catálogo, siempre las 11 (aunque estén vacías). */
export function groupForKanban<T extends Pick<Booking, "status" | "start_at">>(bookings: T[]): { status: BookingStatus; bookings: T[] }[] {
  const columns = new Map<BookingStatus, T[]>(BOOKING_STATUS_KEYS.map((k) => [k, []]));
  for (const b of bookings) columns.get(b.status)?.push(b);
  return BOOKING_STATUS_KEYS.map((status) => ({
    status,
    bookings: (columns.get(status) ?? []).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)),
  }));
}

/** Columnas a las que se puede arrastrar la tarjeta (F32/F34). */
export function allowedDrops(booking: Pick<Booking, "status" | "start_at">, now: Date): BookingStatus[] {
  return BOOKING_STATUS_KEYS.filter((to) => canTransition(booking.status, to, booking, now));
}
