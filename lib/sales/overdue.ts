/**
 * La mora automática (plano F30). Puro: lo usan el handler `payments_overdue_sweep` y los
 * tests de paridad con la función SQL `private.enqueue_payments_overdue_sweep` (00167).
 */
import { addDays, localHour, localToday } from "@/lib/shared/dates";

export { localToday };

/** A partir de esta hora local (zona del workspace) se encola el barrido del día. */
export const SWEEP_LOCAL_HOUR = 3;

/** Las ventas cuyos pagos el barrido NO toca. */
export const SWEEP_SKIPPED_SALE_STATUSES = ["cancelled", "refunded", "disputed", "subscription_cancelled"] as const;

export interface OverdueCandidate {
  status: string;
  due_date: string | null;
}

/**
 * Un pago programado pasa a moroso cuando `due_date < hoy − días de gracia`: con gracia 0, el que
 * vence hoy NO pasa y el de ayer sí; con gracia 3, el de hace 3 días no y el de hace 4 sí.
 */
export function isOverdue(payment: OverdueCandidate, todayLocal: string, graceDays: number): boolean {
  if (payment.status !== "scheduled" || !payment.due_date) return false;
  const grace = Math.max(0, Math.floor(Number(graceDays) || 0));
  return payment.due_date < addDays(todayLocal, -grace);
}

/** La fecha de corte: todo `scheduled` con `due_date` anterior a esta es moroso. */
export function overdueCutoff(todayLocal: string, graceDays: number): string {
  return addDays(todayLocal, -Math.max(0, Math.floor(Number(graceDays) || 0)));
}

/** Espejo de la condición de la función SQL: antes de las 03:00 locales no se encola nada. */
export function shouldEnqueueSweep(now: Date, timeZone: string): boolean {
  return localHour(now, timeZone) >= SWEEP_LOCAL_HOUR;
}

/** La clave que impide dos barridos pendientes del mismo workspace y día local. */
export function sweepDedupeKey(workspaceId: string, localDay: string): string {
  return `overdue:${workspaceId}:${localDay}`;
}
