/**
 * Los próximos horarios libres que ofrece «Agendar» (25/11/2026, traído de RER #128). PURO.
 *
 * Salen de `getPublicSlots`, la MISMA función que la página pública (vía `slotsForManualBooking`): el equipo no ve un
 * hueco que el invitado no vería. Elegir uno solo completa día y hora; al agendar, el servidor vuelve a comprobar que
 * quien atiende no tenga otra reunión a esa hora.
 */
import { dateInTz, minutesOfDayInTz, minutesToWallTime } from "@/lib/scheduling/time/tz";

/** Cuántos días hacia adelante se buscan y cuántos horarios se muestran. */
export const FREE_SLOTS_DAYS = 14;
export const FREE_SLOTS_SHOWN = 8;

/** Los primeros `limit` horarios, en orden, de lo que devuelve la búsqueda (agrupado por día). */
export function firstFreeSlots(byDay: Record<string, Array<{ startUtc: string }>>, nowIso: string, limit = FREE_SLOTS_SHOWN): string[] {
  const all = Object.values(byDay)
    .flat()
    .map((s) => s.startUtc)
    .filter((s) => s > nowIso);
  return [...new Set(all)].sort().slice(0, limit);
}

/** El día y la hora (en la zona de quien agenda) que completa el formulario. */
export function slotToWallClock(startUtc: string, timeZone: string): { date: string; time: string } {
  const d = new Date(startUtc);
  return { date: dateInTz(d, timeZone), time: minutesToWallTime(minutesOfDayInTz(d, timeZone)) };
}

/** «Mar 25 nov · 10:00». */
export function freeSlotLabel(startUtc: string, timeZone: string): string {
  const d = new Date(startUtc);
  const day = new Intl.DateTimeFormat("es", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(d).replace(/\./g, "");
  const time = new Intl.DateTimeFormat("es", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${time}`;
}
