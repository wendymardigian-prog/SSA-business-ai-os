/**
 * Lo que va a salir por un numero de WhatsApp en los proximos dias (la proyeccion del grafico diario). PURO.
 *
 * Es una estimacion, no una promesa:
 *   - broadcasts en cola: se reparten simulando el carril del numero con su ritmo (espera entre mensajes, topes por
 *     minuto, hora y dia, y el horario de envio en la zona del negocio), uno detras de otro, como los toma la cola;
 *   - pasos de secuencias ya agendados (`next_step_at`): un mensaje cada uno, el dia que vence (uno vencido, hoy);
 *   - automatizaciones «En una fecha y hora» que mandan a grupos: un mensaje por paso de grupo y por vez.
 *
 * Los dias van en la zona de quien mira (como el grafico); el ritmo, en la del negocio (como la cola).
 */

import { civilDate } from "@/lib/dates";
import { hourlyRate, isInWindow, nextWindowOpen, startOfNextDay, type SendPolicy } from "@/lib/send-queue/pace";

export const PROJECTION_DAYS = 7;

export interface ProjectedDay {
  broadcast: number;
  sequence: number;
  scheduled: number;
}

export type Projection = Record<string, ProjectedDay>;

export function dayKey(instant: Date, timeZone: string): string {
  const { year, month, day } = civilDate(instant, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Hoy y los dias siguientes, en la zona de quien mira. */
export function projectionDays(now: Date, timeZone: string, days: number = PROJECTION_DAYS): string[] {
  const today = civilDate(now, timeZone);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  });
}

function emptyProjection(keys: readonly string[]): Projection {
  return Object.fromEntries(keys.map((k) => [k, { broadcast: 0, sequence: 0, scheduled: 0 }]));
}

export interface QueuedBroadcast {
  /** Desde cuando puede salir: ahora o la hora programada. */
  start: Date;
  pending: number;
  policy: SendPolicy;
}

const STEP_MIN = 15;

/**
 * Reparte los broadcasts en cola por dia, uno detras de otro y compartiendo los topes diarios del numero.
 * `sentToday` = lo que el carril ya mando hoy (en la zona del negocio).
 */
export function projectBroadcasts(
  queue: readonly QueuedBroadcast[],
  opts: { now: Date; laneTimeZone: string; viewerTimeZone: string; sentToday?: number; days?: number },
): Record<string, number> {
  const keys = projectionDays(opts.now, opts.viewerTimeZone, opts.days);
  const out: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  const horizon = new Set(keys);
  const last = keys[keys.length - 1];
  let t = opts.now;
  let laneDay = dayKey(t, opts.laneTimeZone);
  let laneCount = opts.sentToday ?? 0;

  const ordered = [...queue].filter((q) => q.pending > 0).sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const item of ordered) {
    const rate = hourlyRate(item.policy);
    if (!(rate > 0)) continue;
    const perStep = Number.isFinite(rate) ? rate * (STEP_MIN / 60) : item.pending;
    if (item.start > t) t = item.start;
    let remaining = item.pending;
    let guard = 0;
    while (remaining > 0 && guard++ < 5000) {
      if (!isInWindow(item.policy.window, t, opts.laneTimeZone)) t = nextWindowOpen(item.policy.window, t, opts.laneTimeZone);
      const viewerDay = dayKey(t, opts.viewerTimeZone);
      if (viewerDay > last) return out;
      const lane = dayKey(t, opts.laneTimeZone);
      if (lane !== laneDay) {
        laneDay = lane;
        laneCount = 0;
      }
      const dayLeft = item.policy.perDay === null ? Infinity : item.policy.perDay - laneCount;
      if (dayLeft <= 0) {
        t = nextWindowOpen(item.policy.window, startOfNextDay(t, opts.laneTimeZone), opts.laneTimeZone);
        continue;
      }
      const take = Math.min(remaining, perStep, dayLeft);
      if (horizon.has(viewerDay)) out[viewerDay] += take;
      remaining -= take;
      laneCount += take;
      if (remaining > 0) t = new Date(t.getTime() + STEP_MIN * 60_000);
    }
  }
  for (const k of keys) out[k] = Math.round(out[k]);
  return out;
}

/** Cada instante es un mensaje; uno ya vencido cuenta hoy. Lo que cae despues del horizonte no cuenta. */
export function bucketTimes(times: readonly (Date | string)[], opts: { now: Date; viewerTimeZone: string; days?: number; weight?: number }): Record<string, number> {
  const keys = projectionDays(opts.now, opts.viewerTimeZone, opts.days);
  const out: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const raw of times) {
    const instant = typeof raw === "string" ? new Date(raw) : raw;
    if (Number.isNaN(instant.getTime())) continue;
    const key = instant <= opts.now ? keys[0] : dayKey(instant, opts.viewerTimeZone);
    if (key in out) out[key] += opts.weight ?? 1;
  }
  return out;
}

export function combineProjection(
  keys: readonly string[],
  parts: { broadcast?: Record<string, number>; sequence?: Record<string, number>; scheduled?: Record<string, number> },
): Projection {
  const out = emptyProjection(keys);
  for (const k of keys) {
    out[k].broadcast = parts.broadcast?.[k] ?? 0;
    out[k].sequence = parts.sequence?.[k] ?? 0;
    out[k].scheduled = parts.scheduled?.[k] ?? 0;
  }
  return out;
}
