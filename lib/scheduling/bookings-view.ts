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

/**
 * Los filtros de la pantalla de agendas (F33). Puro: recibe las filas y
 * decide. La base ya aplica el alcance con RLS; el alcance va igual acá para
 * que la pantalla no muestre de más si alguna consulta usa el service role
 * (el agendar manual, por ejemplo).
 */
export interface BookingFilters {
  quick?: QuickFilter | null;
  statuses?: BookingStatus[] | null;
  /** Ids de área y de tipo ya expandidos con `expandCategoryFilter`. */
  categoryIds?: string[] | null;
  hostUserIds?: string[] | null;
  eventTypeIds?: string[] | null;
  /** Nombre, email o teléfono de quien agendó, sin distinguir mayúsculas. */
  search?: string | null;
  /** Rango visible (calendario). Se compara contra el inicio. */
  from?: string | null;
  to?: string | null;
}

export interface BookingScope {
  /** `own` = solo las que tiene como anfitrión. */
  scope: "own" | "all";
  userId: string;
}

type FilterableBooking = Pick<Booking, "status" | "start_at" | "end_at" | "host_user_id" | "event_type_id"> & {
  category_snapshot?: Booking["category_snapshot"];
  booker_name?: string | null;
  booker_email?: string | null;
  booker_phone?: string | null;
};

export function filterBookings<T extends FilterableBooking>(
  bookings: T[],
  filters: BookingFilters,
  now: Date,
  scope?: BookingScope,
): T[] {
  const needle = filters.search?.trim().toLowerCase() ?? "";

  const filtered = bookings.filter((b) => {
    if (scope?.scope === "own" && b.host_user_id !== scope.userId) return false;
    if (filters.quick && quickFilterOf(b, now) !== filters.quick) return false;
    if (filters.statuses?.length && !filters.statuses.includes(b.status)) return false;
    if (filters.hostUserIds?.length && !filters.hostUserIds.includes(b.host_user_id)) return false;
    if (filters.eventTypeIds?.length && !filters.eventTypeIds.includes(b.event_type_id)) return false;

    if (filters.categoryIds?.length) {
      // Se filtra por el snapshot: si después renombran o archivan la
      // categoría, la agenda vieja sigue apareciendo donde apareció siempre.
      const snap = b.category_snapshot ?? null;
      const ids = [snap?.area_id, snap?.type_id].filter(Boolean) as string[];
      if (!ids.some((id) => filters.categoryIds!.includes(id))) return false;
    }

    if (filters.from && Date.parse(b.start_at) < Date.parse(filters.from)) return false;
    if (filters.to && Date.parse(b.start_at) >= Date.parse(filters.to)) return false;

    if (needle) {
      const haystack = [b.booker_name, b.booker_email, b.booker_phone].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  // Próximas hacia adelante; todo lo demás, lo más reciente primero.
  const ascending = filters.quick === "upcoming";
  return filtered.sort((a, b) => (ascending ? 1 : -1) * (Date.parse(a.start_at) - Date.parse(b.start_at)));
}
