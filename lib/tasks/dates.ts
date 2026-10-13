/**
 * Aritmetica de fechas AAAA-MM-DD, sin horas ni zonas: todo en UTC sobre el calendario civil.
 * Pura y determinista: no lee el reloj. "Hoy" siempre lo recibe quien llama.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function toUtcMs(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`fecha invalida: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** `date` + `days` dias corridos (puede ser negativo). */
export function addDays(date: string, days: number): string {
  const t = new Date(toUtcMs(date) + days * 86_400_000);
  const y = String(t.getUTCFullYear()).padStart(4, "0");
  const mo = String(t.getUTCMonth() + 1).padStart(2, "0");
  const d = String(t.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/** Dias entre dos fechas: `b - a`. */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86_400_000);
}

/** La fecha civil de un instante ISO, en la zona dada (para `completed_at` -> "completado el"). */
export function dateOfInstant(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
