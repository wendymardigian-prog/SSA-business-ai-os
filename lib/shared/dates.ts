/**
 * Fechas "del día" en la zona del workspace (plano §16): los instantes viven en
 * UTC en la base; los vencimientos son `date` interpretados en la zona del
 * negocio. No hay `date-fns` en SSA: se usa `Intl` (sin dependencias nuevas).
 */

/** La fecha local `YYYY-MM-DD` de un instante en esa zona. */
export function localDate(instant: Date | string | number, timeZone: string): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "Hoy" en la zona del workspace. */
export function localToday(now: Date, timeZone: string): string {
  return localDate(now, timeZone);
}

/** La hora local (0–23) de un instante en esa zona. */
export function localHour(instant: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(instant);
  return Number(h) || 0;
}

/** Días de calendario de `from` a `to` (ambos `YYYY-MM-DD`). Positivo si `to` es posterior. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** Suma días a una fecha `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Suma meses sin desbordar: 31 de enero + 1 mes = 28 (o 29) de febrero. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}
