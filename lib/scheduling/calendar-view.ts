/**
 * Vista calendario (F35): ubica cada agenda en el día de la zona de quien
 * mira. Las canceladas se ocultan salvo `includeCancelled`.
 */
import type { Booking } from "./types";
import { dateInTz, minutesOfDayInTz, addDays, eachDate } from "./time/tz";
import { isCancelled, statusDef } from "./booking-status";

export type CalendarView = "month" | "week" | "day";

export interface CalendarItem<T = Booking> {
  booking: T;
  /** Fecha `YYYY-MM-DD` del día de inicio en la zona. */
  date: string;
  /** Minutos desde la medianoche local del inicio (0-1439). */
  startMinutes: number;
  /** Minutos desde la medianoche local del día de inicio del fin; puede superar 1440. */
  endMinutes: number;
  /** Termina otro día distinto del de inicio. */
  crossesMidnight: boolean;
  statusColor: string;
  statusLabel: string;
  eventColor: string | null;
}

export interface CalendarPlacement<T = Booking> {
  view: CalendarView;
  items: CalendarItem<T>[];
  /** Ítems por fecha, con todas las fechas del rango (vacías incluidas) cuando se pasa `range`. */
  byDate: Record<string, CalendarItem<T>[]>;
}

export interface PlaceOptions {
  includeCancelled?: boolean;
  /** Fechas `YYYY-MM-DD` del rango que muestra la vista, para incluir los días vacíos. */
  range?: { from: string; to: string };
}

export function placeInCalendar<T extends Pick<Booking, "status" | "start_at" | "end_at" | "event_color">>(
  bookings: T[],
  tz: string,
  view: CalendarView,
  options: PlaceOptions = {},
): CalendarPlacement<T> {
  const items: CalendarItem<T>[] = [];

  for (const b of bookings) {
    if (!options.includeCancelled && isCancelled(b.status)) continue;
    const date = dateInTz(b.start_at, tz);
    const endDate = dateInTz(b.end_at, tz);
    const startMinutes = minutesOfDayInTz(b.start_at, tz);
    let endMinutes = minutesOfDayInTz(b.end_at, tz);
    const crossesMidnight = endDate !== date;
    if (crossesMidnight) {
      // Cuántos días después termina, contados en el calendario local.
      let days = 0;
      for (let d = date; d !== endDate && days < 366; d = addDays(d, 1)) days++;
      endMinutes += days * 1440;
    }
    const def = statusDef(b.status);
    items.push({
      booking: b,
      date,
      startMinutes,
      endMinutes,
      crossesMidnight,
      statusColor: def.color,
      statusLabel: def.label,
      eventColor: b.event_color ?? null,
    });
  }

  items.sort((a, b) => Date.parse(a.booking.start_at) - Date.parse(b.booking.start_at));

  const byDate: Record<string, CalendarItem<T>[]> = {};
  if (options.range) for (const d of eachDate(options.range.from, options.range.to)) byDate[d] = [];
  for (const item of items) (byDate[item.date] ??= []).push(item);

  return { view, items, byDate };
}
