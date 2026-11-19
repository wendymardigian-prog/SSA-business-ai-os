/**
 * Si un envío de la cola de WhatsApp puede salir ahora, y si no, por qué y cuándo volver a mirar. PURO.
 *
 * Reglas:
 *   - Horario: lo que va por la cola sale solo dentro del horario de envío del número (`send_policy.window`), también lo
 *     urgente. SSA no tiene un horario «oficial» aparte: es el mismo de los broadcasts.
 *   - Topes por minuto, por hora y por día del número, contando TODO lo que sale por él (`send_lane_counts`, 00420).
 *   - Reserva de urgentes: lo normal y lo masivo usan como mucho el cupo por hora menos la reserva (con 60 y 20 %, 48); lo
 *     urgente puede llegar a 60. Los broadcasts cuentan como masivo (decisión del 18/11/2026).
 *   - Lo masivo solo sale cuando no hay nada urgente ni normal esperando (lo decide el orden de `claim_send_queue_item`) y
 *     se puede pausar entero por número.
 */
import type { SendQueuePriority } from "@/lib/types/database";
import { isInWindow, nextWindowOpen, startOfNextDay, type LaneCounts, type SendPolicy } from "@/lib/send-queue/pace";
import type { QueuePolicy } from "./policy";

export type QueueBlock = "window" | "minute" | "hour" | "hour_reserved" | "day";

export type QueueDecision = { ok: true } | { ok: false; reason: QueueBlock; retryAt: Date };

/** El cupo por hora que puede usar una prioridad: lo urgente, todo; lo demás, sin la reserva. */
export function hourlyLimitFor(policy: Pick<QueuePolicy, "perHour" | "urgentReservePct">, priority: SendQueuePriority): number | null {
  if (policy.perHour === null) return null;
  if (priority === "urgent") return policy.perHour;
  const reserved = Math.ceil((policy.perHour * policy.urgentReservePct) / 100);
  return Math.max(0, policy.perHour - reserved);
}

/**
 * El techo de un broadcast por este número: el del número (con su calentamiento) y, por hora, sin la reserva de lo
 * urgente. Así un broadcast nunca se come el lugar de un recordatorio.
 */
export function bulkCeiling(policy: QueuePolicy): SendPolicy {
  return { ...policy, perHour: hourlyLimitFor(policy, "bulk") };
}

/** ¿Puede salir un envío de esta prioridad ahora? Si no, por qué y cuándo volver a mirar. */
export function queueDecision(policy: QueuePolicy, counts: LaneCounts, priority: SendQueuePriority, now: Date, timeZone: string): QueueDecision {
  if (!isInWindow(policy.window, now, timeZone)) {
    return { ok: false, reason: "window", retryAt: nextWindowOpen(policy.window, now, timeZone) };
  }
  if (policy.perDay !== null && counts.today >= policy.perDay) {
    return { ok: false, reason: "day", retryAt: nextWindowOpen(policy.window, startOfNextDay(now, timeZone), timeZone) };
  }
  const hourly = hourlyLimitFor(policy, priority);
  if (hourly !== null && counts.lastHour >= hourly) {
    const reservedLeft = policy.perHour !== null && counts.lastHour < policy.perHour;
    return { ok: false, reason: reservedLeft ? "hour_reserved" : "hour", retryAt: new Date(now.getTime() + 5 * 60_000) };
  }
  if (policy.perMinute !== null && counts.lastMinute >= policy.perMinute) {
    return { ok: false, reason: "minute", retryAt: new Date(now.getTime() + 15_000) };
  }
  return { ok: true };
}

/**
 * Qué prioridades pueden salir ahora mismo en el carril, en orden. Vacío = ninguna (y el carril espera `retryAt`, lo
 * más pronto que alguna podría).
 */
export function allowedPriorities(
  policy: QueuePolicy,
  counts: LaneCounts,
  now: Date,
  timeZone: string,
  opts: { bulkPaused: boolean },
): { priorities: SendQueuePriority[]; retryAt: Date | null; blocks: Partial<Record<SendQueuePriority, QueueBlock>> } {
  const priorities: SendQueuePriority[] = [];
  const blocks: Partial<Record<SendQueuePriority, QueueBlock>> = {};
  let retryAt: Date | null = null;
  for (const p of ["urgent", "normal", "bulk"] as const) {
    if (p === "bulk" && opts.bulkPaused) continue;
    const d = queueDecision(policy, counts, p, now, timeZone);
    if (d.ok) priorities.push(p);
    else {
      blocks[p] = d.reason;
      if (!retryAt || d.retryAt < retryAt) retryAt = d.retryAt;
    }
  }
  return { priorities, retryAt: priorities.length ? null : retryAt, blocks };
}

/** El porcentaje del cupo de la hora usado, para la tarjeta del número (null si no hay tope). */
export function hourUsagePct(policy: Pick<QueuePolicy, "perHour">, lastHour: number): number | null {
  if (policy.perHour === null || policy.perHour <= 0) return null;
  return Math.round((lastHour / policy.perHour) * 100);
}
