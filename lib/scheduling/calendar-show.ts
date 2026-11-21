/**
 * «Qué mostrar» del calendario de la Agenda: qué estados de reunión se ven. PURO.
 *
 * Es el MISMO filtro `?estado=` del menú Filtros (nunca se contradicen). Sin estados elegidos, el calendario muestra
 * todo menos las canceladas (como siempre); `?reuniones=0` oculta las reuniones del calendario.
 */
import { BOOKING_STATUS_KEYS, CANCELLED_STATUSES } from "./booking-status";
import type { BookingStatus } from "./types";

/** Lo que se ve sin elegir nada: todo menos las canceladas. */
export const DEFAULT_CALENDAR_STATUSES: BookingStatus[] = BOOKING_STATUS_KEYS.filter((s) => !CANCELLED_STATUSES.includes(s));

/** Los estados que se ven en el calendario con el filtro actual. */
export function visibleCalendarStatuses(selected: readonly BookingStatus[]): BookingStatus[] {
  return selected.length ? BOOKING_STATUS_KEYS.filter((s) => selected.includes(s)) : DEFAULT_CALENDAR_STATUSES;
}

/** ¿Hay que dibujar las canceladas? Solo si se eligió alguna. */
export function showsCancelled(selected: readonly BookingStatus[]): boolean {
  return selected.some((s) => CANCELLED_STATUSES.includes(s));
}

/**
 * Los parámetros de la URL para una selección nueva de estados: igual a lo de siempre → sin `estado`; vacía → se
 * ocultan las reuniones (`reuniones=0`); si no, la lista (`estado` va repetido, como lo escribe el menú Filtros).
 */
export function statusParams(next: readonly BookingStatus[]): { estado: string[] | null; reuniones: string | null } {
  const ordered = BOOKING_STATUS_KEYS.filter((s) => next.includes(s));
  if (ordered.length === 0) return { estado: null, reuniones: "0" };
  const isDefault = ordered.length === DEFAULT_CALENDAR_STATUSES.length && ordered.every((s) => DEFAULT_CALENDAR_STATUSES.includes(s));
  return { estado: isDefault ? null : ordered, reuniones: null };
}

export function parseMeetingsShown(value: string | string[] | null | undefined): boolean {
  const v = Array.isArray(value) ? value[0] : value;
  return v !== "0";
}
