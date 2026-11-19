/**
 * Envíos programados de la cola de WhatsApp. PURO.
 *
 * Un paso de WhatsApp que va por la cola puede decir «N minutos, horas o días después de que corre el paso». La fecha se
 * calcula UNA VEZ, al correr el paso, y queda en la fila de la cola junto con el texto: editar la automatización después
 * NO la reescribe. Para aplicar el cambio a lo que ya está programado hay una acción aparte («Aplicar a los envíos
 * programados»), que recalcula la fecha desde el momento guardado (`anchor_at`).
 *
 * La diferencia con el paso «Esperar»: «Esperar» deja la ejecución abierta y, al reanudar, corre la versión NUEVA del paso
 * siguiente (texto incluido). El envío programado congela el texto y la ejecución sigue sin esperar.
 *
 * Un envío que, al aplicar una programación nueva, ya tendría que haber salido no se envía: queda «vencido». Así, cambiar
 * «a los 7 días» por «a los 3» y aplicarlo no manda una avalancha a quien ya pasó el día 3.
 */

export type ScheduleUnit = "minutes" | "hours" | "days";

export interface ScheduleConfig {
  enabled: boolean;
  amount: number;
  unit: ScheduleUnit;
}

export const NO_SCHEDULE: ScheduleConfig = { enabled: false, amount: 1, unit: "days" };

const UNIT_MS: Record<ScheduleUnit, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
const MAX_AMOUNT: Record<ScheduleUnit, number> = { minutes: 60 * 24 * 30, hours: 24 * 365, days: 730 };

export const UNIT_LABELS: Record<ScheduleUnit, string> = { minutes: "minutos", hours: "horas", days: "días" };

/** Lo guardado en el paso, leído sin lanzar. Algo raro = sin programar. */
export function parseSchedule(raw: unknown): ScheduleConfig {
  if (!raw || typeof raw !== "object") return NO_SCHEDULE;
  const r = raw as Record<string, unknown>;
  const unit: ScheduleUnit = r.unit === "minutes" || r.unit === "hours" || r.unit === "days" ? r.unit : "days";
  const amountRaw = typeof r.amount === "number" ? r.amount : Number(r.amount);
  const amount = Number.isFinite(amountRaw) ? Math.round(amountRaw) : 0;
  return { enabled: r.enabled === true, amount, unit };
}

/** Qué está mal en la programación (para no publicar), o null. */
export function scheduleProblem(raw: unknown): string | null {
  const s = parseSchedule(raw);
  if (!s.enabled) return null;
  if (!Number.isInteger(s.amount) || s.amount < 1 || s.amount > MAX_AMOUNT[s.unit]) {
    return "La programación del WhatsApp no es válida: escribí cuánto tiempo después (un número entero, desde 1).";
  }
  return null;
}

/** La fecha prevista desde el momento en que corrió el paso. */
export function scheduledForFrom(anchorAt: Date, s: ScheduleConfig): Date {
  return new Date(anchorAt.getTime() + s.amount * UNIT_MS[s.unit]);
}

/** Margen para «nació con la fecha pasada». */
export const OVERDUE_GRACE_MS = 60_000;

/** El estado con el que nace un envío: programado (futuro), en cola (ya puede salir) o vencido (nació pasado). */
export function initialStatus(scheduledFor: Date, now: Date, programmed: boolean): "scheduled" | "queued" | "overdue" {
  if (!programmed) return "queued";
  if (scheduledFor.getTime() < now.getTime() - OVERDUE_GRACE_MS) return "overdue";
  return scheduledFor.getTime() > now.getTime() ? "scheduled" : "queued";
}

/**
 * «Aplicar a los envíos programados»: lo nuevo para un envío programado que todavía no salió, desde su momento guardado.
 * Si con la regla nueva ya habría tenido que salir, queda vencido (no sale de golpe). Sin programación, sale ya.
 */
export function reapplySchedule(anchorAt: Date, s: ScheduleConfig, now: Date): { scheduledFor: Date; status: "scheduled" | "queued" | "overdue" } {
  if (!s.enabled) return { scheduledFor: now, status: "queued" };
  const scheduledFor = scheduledForFrom(anchorAt, s);
  return { scheduledFor, status: initialStatus(scheduledFor, now, true) };
}

/** «3 días después de que corre el paso». */
export function describeSchedule(s: ScheduleConfig): string {
  if (!s.enabled) return "Al momento";
  const unit = s.unit === "days" ? (s.amount === 1 ? "día" : "días") : s.unit === "hours" ? (s.amount === 1 ? "hora" : "horas") : s.amount === 1 ? "minuto" : "minutos";
  return `${s.amount} ${unit} después de que corre el paso`;
}
