/**
 * Las fechas de la bandeja por DIA DE CALENDARIO de quien mira, no por "hace
 * menos de 24 horas". Antes un mensaje de ayer a la tarde, mirado hoy temprano,
 * decia "Today": la cuenta era `floor((ahora - mensaje) / 24 h)`. Modulo PURO:
 * usa la zona del navegador (la de `Date`), como el resto de la bandeja.
 */

/** Cuantos dias de calendario pasaron entre la fecha y `now` (0 = hoy, 1 = ayer). */
export function calendarDaysAgo(date: Date, now: Date): number {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // Math.round: un dia de cambio de horario dura 23 o 25 horas.
  return Math.round((today - day) / 86_400_000);
}

/** El separador del hilo: "Hoy", "Ayer" o la fecha con el dia de la semana. */
export function threadDayLabel(date: Date, now: Date = new Date()): string {
  const days = calendarDaysAgo(date, now);
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  return date.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** La hora de la fila de la lista: la hora si es de hoy, "Ayer", el dia de la semana o la fecha. */
export function listTimeLabel(date: Date, now: Date = new Date()): string {
  const days = calendarDaysAgo(date, now);
  if (days <= 0) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Ayer";
  if (days < 7) return date.toLocaleDateString("es-AR", { weekday: "short" });
  return date.toLocaleDateString("es-AR", { month: "short", day: "numeric" });
}
