/**
 * Las fechas de la bandeja por DIA DE CALENDARIO de quien mira, no por "hace
 * menos de 24 horas". Antes un mensaje de ayer a la tarde, mirado hoy temprano,
 * decia "Today": la cuenta era `floor((ahora - mensaje) / 24 h)`. Modulo PURO:
 * la zona la pasa quien llama (la de `useViewerTimezone`), nunca sale del
 * navegador: el dia de alguien que eligio otra zona es el de esa zona.
 */

import { calendarDaysAgo, civilDate } from "@/lib/dates";

/** El separador del hilo: "Hoy", "Ayer" o la fecha con el dia de la semana. */
export function threadDayLabel(date: Date, timeZone: string, now: Date = new Date()): string {
  const days = calendarDaysAgo(date, now, timeZone);
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  return date.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone,
    ...(civilDate(date, timeZone).year !== civilDate(now, timeZone).year ? { year: "numeric" } : {}),
  });
}

/** La hora de la fila de la lista: la hora si es de hoy, "Ayer", el dia de la semana o la fecha. */
export function listTimeLabel(date: Date, timeZone: string, now: Date = new Date()): string {
  const days = calendarDaysAgo(date, now, timeZone);
  if (days <= 0) return date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone });
  if (days === 1) return "Ayer";
  if (days < 7) return date.toLocaleDateString("es-AR", { weekday: "short", timeZone });
  return date.toLocaleDateString("es-AR", { month: "short", day: "numeric", timeZone });
}
