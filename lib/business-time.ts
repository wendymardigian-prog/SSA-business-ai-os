/**
 * Lo que se programa en la hora del NEGOCIO (`workspaces.timezone`) y se le muestra a una persona que puede vivir en
 * otra zona: cómo se llama esa zona y a qué hora le cae a quien mira. PURO: lo usan los paneles de las automatizaciones
 * (disparadores, «Esperar hasta», recordatorios, horarios) a través de `BusinessTimeNote`.
 *
 * Una hora de pared («las 09:00») se convierte con una FECHA de referencia: con el horario de verano, la misma hora del
 * negocio le cae a otra hora a quien mira según el día del año.
 */
import { civilDate, datetimeInputToIso, timeZoneLabel } from "@/lib/dates";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const pad = (n: number) => String(n).padStart(2, "0");

/** El nombre de una zona para leer: «America/Argentina/Buenos_Aires» → «Buenos Aires». */
export function zoneName(timeZone: string): string {
  if (!timeZone || timeZone === "UTC" || timeZone === "Etc/UTC") return "UTC";
  const last = timeZone.split("/").pop() ?? timeZone;
  return last.replace(/_/g, " ");
}

/** La zona con su diferencia con UTC ese día: «Buenos Aires (GMT-3)». */
export function zoneLabel(timeZone: string, at: Date = new Date()): string {
  const name = zoneName(timeZone);
  return name === "UTC" ? "UTC" : `${name} (${timeZoneLabel(timeZone, at)})`;
}

/** Si dos zonas marcan la misma hora ese día (dos nombres para lo mismo cuentan como iguales). */
export function sameClock(a: string, b: string, at: Date = new Date()): boolean {
  if (a === b) return true;
  const fmt = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  try {
    return fmt(a) === fmt(b);
  } catch {
    return false;
  }
}

export interface ConvertedTime {
  /** `HH:mm` en la zona de destino. */
  time: string;
  /** -1 = cae el día anterior, 1 = el día siguiente, 0 = el mismo día. */
  dayShift: -1 | 0 | 1;
}

/**
 * Una hora de pared de la zona `from` («09:00 en Buenos Aires»), el día de `at` en esa zona, vista en la zona `to`.
 * null si la hora no sirve.
 */
export function convertWallTime(time: string, from: string, to: string, at: Date = new Date()): ConvertedTime | null {
  if (!TIME_RE.test(time)) return null;
  const day = civilDate(at, from);
  const iso = datetimeInputToIso(`${day.year}-${pad(day.month)}-${pad(day.day)}T${time}`, from);
  if (!iso) return null;
  const instant = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: to, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const there = Date.UTC(get("year"), get("month") - 1, get("day"));
  const here = Date.UTC(day.year, day.month - 1, day.day);
  const diff = Math.round((there - here) / 86_400_000);
  return { time: `${pad(get("hour") % 24)}:${pad(get("minute"))}`, dayShift: diff < 0 ? -1 : diff > 0 ? 1 : 0 };
}

/** «13:00», «02:00 (del día siguiente)», «21:00 (del día anterior)». */
export function convertedTimeText(converted: ConvertedTime): string {
  if (converted.dayShift === 1) return `${converted.time} (del día siguiente)`;
  if (converted.dayShift === -1) return `${converted.time} (del día anterior)`;
  return converted.time;
}

/** Un instante escrito en una zona: «lunes 9 de noviembre de 2026, 09:00». */
export function formatInstantIn(instant: Date, timeZone: string): string {
  return instant.toLocaleString("es", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
