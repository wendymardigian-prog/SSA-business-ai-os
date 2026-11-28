// @plantilla-quitar(servicios)
/**
 * Cuándo una clase es «próxima», «en curso» o «pasada», por su HORA real (no por la fecha): así la clase de esta noche
 * no desaparece de Próximas porque en UTC ya es mañana. PURO.
 *
 * - Próxima: todavía no terminó (`ends_at > ahora`). Una clase en curso sigue en Próximas, con la marca «En curso».
 * - Pasada: ya terminó (`ends_at <= ahora`).
 *
 * Las fechas límite de lo que se pide a la base (90 días atrás, 60 adelante) se cuentan con el día del NEGOCIO, con un
 * día de margen a cada lado: la hora decide después.
 */
import { todayInputValue } from "@/lib/dates";
import { zoneName } from "@/lib/business-time";

interface Timed {
  starts_at: string;
  ends_at: string;
}

const ms = (iso: string) => new Date(iso).getTime();

export function hasEnded(o: Timed, now: number): boolean {
  return ms(o.ends_at) <= now;
}

export function isLiveNow(o: Timed, now: number): boolean {
  return ms(o.starts_at) <= now && now < ms(o.ends_at);
}

/** Lo que todavía no terminó, ordenado por hora de inicio. */
export function upcomingOnly<T extends Timed>(list: T[], now: number): T[] {
  return list.filter((o) => !hasEnded(o, now)).sort((a, b) => ms(a.starts_at) - ms(b.starts_at));
}

/** Lo que ya terminó (una clase en curso queda afuera: está en Próximas). */
export function pastOnly<T extends Timed>(list: T[], now: number): T[] {
  return list.filter((o) => hasEnded(o, now));
}

/** `YYYY-MM-DD` más `n` días (fecha civil, sin zona). */
export function addDaysIso(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Los rangos que se piden a la base, con el día del negocio y un día de margen. */
export function calendarWindows(now: Date, businessTz: string): { today: string; upcomingFrom: string; upcomingTo: string; pastFrom: string; pastTo: string } {
  let today: string;
  try {
    today = todayInputValue(now, businessTz || "UTC");
  } catch {
    today = now.toISOString().slice(0, 10);
  }
  return {
    today,
    upcomingFrom: addDaysIso(today, -1),
    upcomingTo: addDaysIso(today, 60),
    pastFrom: addDaysIso(today, -90),
    pastTo: addDaysIso(today, 1),
  };
}

/** La hora de una clase en la zona de quien mira, con el nombre de esa zona: «19:00 (Costa Rica)». */
export function classTimeLabel(startsAt: string, viewerTz: string): string {
  try {
    const hhmm = new Intl.DateTimeFormat("es", { timeZone: viewerTz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(startsAt));
    return `${hhmm} (${zoneName(viewerTz)})`;
  } catch {
    return "";
  }
}
