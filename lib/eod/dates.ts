/**
 * Las fechas de un reporte de fin de día. El día es el de la PERSONA (su zona horaria
 * de `user_preferences`), no el del workspace: un setter en otro país reporta su día.
 * Puro; "hoy" lo calcula quien llama con `todayInputValue(now, tz)`.
 */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** `2026-10-12` + 1 = `2026-10-13`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type ReportDateProblem = "invalid" | "future" | "too_old";

/** Nunca una fecha futura, y como mucho `pastDays` hacia atrás (0 = solo hoy). */
export function reportDateProblem(date: unknown, today: string, pastDays: number): ReportDateProblem | null {
  if (!isIsoDate(date)) return "invalid";
  if (date > today) return "future";
  if (date < addDays(today, -Math.max(0, pastDays))) return "too_old";
  return null;
}

export const REPORT_DATE_MESSAGES: Record<ReportDateProblem, string> = {
  invalid: "La fecha no es válida",
  future: "No se puede reportar un día que todavía no pasó",
  too_old: "Ese día ya no se puede reportar",
};

/** El rango del selector de fecha. */
export function allowedDateRange(today: string, pastDays: number): { min: string; max: string } {
  return { min: addDays(today, -Math.max(0, pastDays)), max: today };
}

/** "12/10" para los avisos. */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(d)}/${Number(m)}`;
}
