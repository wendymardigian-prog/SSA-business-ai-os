/**
 * El rango de fechas que dibuja cada vista del calendario de agendas (F35).
 *
 * Vive en su propio archivo, fuera del componente, porque lo usa también la
 * página (Server Component) para pedir a la base solo las agendas del rango
 * visible: importar un valor de un módulo `"use client"` desde el servidor
 * devuelve una referencia al cliente, no la función. (Es el mismo tropiezo que
 * hubo con las secciones del editor de eventos.)
 *
 * Puro: entra una fecha `YYYY-MM-DD` y sale otro par de fechas.
 */

import type { CalendarView } from "./calendar-view";
import { addDays } from "./time/tz";

/** Día de la semana con el lunes en 0, sobre una fecha `YYYY-MM-DD`. */
function weekdayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** El lunes de la semana de esa fecha. La semana arranca el lunes. */
export function mondayOf(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

/** Cuántos días tiene el mes de esa fecha. */
export function daysInMonthOf(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * El rango visible, de lunes a domingo en semana y mes: así la grilla no
 * empieza a mitad de semana y los días de relleno se ven como en cualquier
 * calendario.
 */
export function rangeFor(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") {
    const from = mondayOf(anchor);
    return { from, to: addDays(from, 6) };
  }
  const month = anchor.slice(0, 7);
  const last = `${month}-${String(daysInMonthOf(anchor)).padStart(2, "0")}`;
  return { from: mondayOf(`${month}-01`), to: addDays(last, 6 - weekdayIndex(last)) };
}

/** La fecha ancla del período anterior o siguiente. */
export function shiftAnchor(view: CalendarView, anchor: string, direction: 1 | -1): string {
  if (view === "day") return addDays(anchor, direction);
  if (view === "week") return addDays(anchor, 7 * direction);
  const [y, m] = anchor.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + direction, 1));
  return dt.toISOString().slice(0, 10);
}
