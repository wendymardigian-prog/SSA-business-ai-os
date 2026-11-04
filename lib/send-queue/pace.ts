/**
 * El ritmo de la cola de envíos (docs/broadcasts.md). Puro: sin base ni red.
 *
 * Un CARRIL es un canal (un número de WhatsApp, el canal de email): todo lo que
 * sale por él comparte el mismo ritmo, porque WhatsApp bloquea por número. El
 * número tiene un TECHO (`channels.send_policy`) y cada broadcast puede ir más
 * lento que ese techo, nunca más rápido (`combinePolicies`).
 *
 * Las reglas:
 * - espera entre mensajes: un número al azar entre un mínimo y un máximo (un
 *   intervalo fijo se nota y WhatsApp lo detecta);
 * - máximo por minuto, por hora (últimos 60 minutos) y por día (el día del
 *   negocio, en su zona horaria);
 * - horario de envío: días de la semana y una franja, en la zona del negocio;
 * - pausa automática si fallan N seguidos (número desconectado o bloqueado).
 */

import { civilDate, startOfDay, zonedClock } from "@/lib/dates";

export interface SendWindow {
  enabled: boolean;
  /** 0 = domingo … 6 = sábado. */
  days: number[];
  /** "HH:MM", hora de pared del negocio. */
  start: string;
  end: string;
}

export interface SendPolicy {
  minGapSeconds: number;
  maxGapSeconds: number;
  /** null = sin tope. */
  perMinute: number | null;
  perHour: number | null;
  perDay: number | null;
  window: SendWindow;
  /** Fallos seguidos que pausan el carril (0 = nunca). */
  pauseAfterFailures: number;
}

/** Lo que un broadcast puede ajustar: solo para ir más lento que el número. */
export interface BroadcastPace {
  minGapSeconds?: number;
  maxGapSeconds?: number;
  perHour?: number | null;
  perDay?: number | null;
}

/** Lo que un número de WhatsApp conectado por QR aguanta sin llamar la atención. */
export const DEFAULT_WHATSAPP_POLICY: SendPolicy = {
  minGapSeconds: 25,
  maxGapSeconds: 60,
  perMinute: 2,
  perHour: 60,
  perDay: 300,
  window: { enabled: true, days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "20:00" },
  pauseAfterFailures: 5,
};

/** Email: sin espera; el tope por minuto cuida el límite de pedidos de Resend. */
export const DEFAULT_EMAIL_POLICY: SendPolicy = {
  minGapSeconds: 0,
  maxGapSeconds: 0,
  perMinute: 100,
  perHour: null,
  perDay: null,
  window: { enabled: false, days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" },
  pauseAfterFailures: 10,
};

export const MAX_GAP_SECONDS = 3600;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function int(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Un tope: un entero positivo, o null (sin tope). Un valor inválido deja el de respaldo. */
function cap(v: unknown, fallback: number | null, max: number): number | null {
  if (v === null) return null;
  if (v === undefined) return fallback;
  const n = int(v, 1, max);
  return n ?? fallback;
}

function parseWindow(raw: unknown, fallback: SendWindow): SendWindow {
  if (!raw || typeof raw !== "object") return fallback;
  const w = raw as Record<string, unknown>;
  const days = Array.isArray(w.days)
    ? [...new Set(w.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : fallback.days;
  const start = typeof w.start === "string" && HHMM.test(w.start) ? w.start : fallback.start;
  const end = typeof w.end === "string" && HHMM.test(w.end) ? w.end : fallback.end;
  const enabled = typeof w.enabled === "boolean" ? w.enabled : fallback.enabled;
  if (start >= end || days.length === 0) return { ...fallback, enabled: enabled && fallback.start < fallback.end };
  return { enabled, days, start, end };
}

/** Lee lo guardado (jsonb) sobre un respaldo. Todo valor raro vuelve al respaldo: nunca lanza. */
export function parsePolicy(raw: unknown, fallback: SendPolicy): SendPolicy {
  if (!raw || typeof raw !== "object") return fallback;
  const p = raw as Record<string, unknown>;
  const minGap = int(p.minGapSeconds, 0, MAX_GAP_SECONDS) ?? fallback.minGapSeconds;
  const maxGap = Math.max(minGap, int(p.maxGapSeconds, 0, MAX_GAP_SECONDS) ?? Math.max(minGap, fallback.maxGapSeconds));
  return {
    minGapSeconds: minGap,
    maxGapSeconds: maxGap,
    perMinute: cap(p.perMinute, fallback.perMinute, 1000),
    perHour: cap(p.perHour, fallback.perHour, 100_000),
    perDay: cap(p.perDay, fallback.perDay, 1_000_000),
    window: parseWindow(p.window, fallback.window),
    pauseAfterFailures: int(p.pauseAfterFailures, 0, 100) ?? fallback.pauseAfterFailures,
  };
}

/** Lo que guarda un broadcast. Solo números válidos; lo demás se descarta. */
export function parseBroadcastPace(raw: unknown): BroadcastPace {
  if (!raw || typeof raw !== "object") return {};
  const p = raw as Record<string, unknown>;
  const out: BroadcastPace = {};
  const minGap = int(p.minGapSeconds, 0, MAX_GAP_SECONDS);
  const maxGap = int(p.maxGapSeconds, 0, MAX_GAP_SECONDS);
  if (minGap !== null) out.minGapSeconds = minGap;
  if (maxGap !== null) out.maxGapSeconds = Math.max(maxGap, minGap ?? 0);
  const perHour = p.perHour === null || p.perHour === undefined ? null : int(p.perHour, 1, 100_000);
  const perDay = p.perDay === null || p.perDay === undefined ? null : int(p.perDay, 1, 1_000_000);
  if (perHour !== null) out.perHour = perHour;
  if (perDay !== null) out.perDay = perDay;
  return out;
}

const minCap = (a: number | null, b: number | null | undefined): number | null => {
  if (b === null || b === undefined) return a;
  if (a === null) return b;
  return Math.min(a, b);
};

/** El techo del número con el ritmo del broadcast: de cada regla, la más lenta. */
export function combinePolicies(ceiling: SendPolicy, own: BroadcastPace): SendPolicy {
  const minGap = Math.max(ceiling.minGapSeconds, own.minGapSeconds ?? 0);
  const maxGap = Math.max(minGap, ceiling.maxGapSeconds, own.maxGapSeconds ?? 0);
  return {
    ...ceiling,
    minGapSeconds: minGap,
    maxGapSeconds: maxGap,
    perHour: minCap(ceiling.perHour, own.perHour),
    perDay: minCap(ceiling.perDay, own.perDay),
  };
}

/** ¿El broadcast intenta ir más rápido que el número? (para avisarlo al guardar). */
export function paceExceedsCeiling(ceiling: SendPolicy, own: BroadcastPace): boolean {
  return (
    (own.minGapSeconds !== undefined && own.minGapSeconds < ceiling.minGapSeconds) ||
    (own.perHour != null && ceiling.perHour !== null && own.perHour > ceiling.perHour) ||
    (own.perDay != null && ceiling.perDay !== null && own.perDay > ceiling.perDay)
  );
}

/** La espera hasta el próximo mensaje, al azar entre el mínimo y el máximo. `rand` en [0, 1). */
export function pickGapSeconds(policy: Pick<SendPolicy, "minGapSeconds" | "maxGapSeconds">, rand: number = Math.random()): number {
  const span = Math.max(0, policy.maxGapSeconds - policy.minGapSeconds);
  const r = Math.min(Math.max(rand, 0), 0.999999);
  return policy.minGapSeconds + Math.floor(r * (span + 1));
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** ¿Este momento está adentro del horario de envío? */
export function isInWindow(window: SendWindow, now: Date, timeZone: string): boolean {
  if (!window.enabled) return true;
  const { weekday, minutes } = zonedClock(now, timeZone);
  return window.days.includes(weekday) && minutes >= toMinutes(window.start) && minutes < toMinutes(window.end);
}

/**
 * Cuándo abre el horario la próxima vez, desde `from` (si ya está adentro, `from`).
 * Cuenta en minutos de pared; un cambio de horario de verano lo corre una hora como mucho.
 */
export function nextWindowOpen(window: SendWindow, from: Date, timeZone: string): Date {
  if (isInWindow(window, from, timeZone)) return from;
  const { weekday, minutes } = zonedClock(from, timeZone);
  const startMin = toMinutes(window.start);
  const base = from.getTime() - from.getUTCSeconds() * 1000 - from.getUTCMilliseconds();
  for (let d = 0; d <= 7; d++) {
    const day = (weekday + d) % 7;
    if (!window.days.includes(day)) continue;
    if (d === 0 && minutes >= startMin) continue; // hoy ya pasó la apertura (o ya cerró)
    return new Date(base + (d * 1440 + startMin - minutes) * 60_000);
  }
  return from; // sin días (no debería pasar: parseWindow lo impide)
}

/** El comienzo del día siguiente del negocio. */
export function startOfNextDay(now: Date, timeZone: string): Date {
  const { year, month, day } = civilDate(now, timeZone);
  const noonUtc = Date.UTC(year, month - 1, day, 12) + 24 * 3600_000;
  const next = new Date(noonUtc);
  return startOfDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone);
}

export interface LaneCounts {
  /** Mensajes de este carril en los últimos 60 segundos (enviados o saliendo). */
  lastMinute: number;
  /** En los últimos 60 minutos. */
  lastHour: number;
  /** Desde el comienzo del día del negocio. */
  today: number;
}

export type PaceBlock = "window" | "minute" | "hour" | "day";

export type PaceDecision = { ok: true } | { ok: false; reason: PaceBlock; retryAt: Date };

/**
 * ¿Puede salir un mensaje ahora? Si no, por qué y cuándo volver a mirar. El
 * reintento del tope por hora es cada 5 minutos (la ventana es corrida: se
 * libera de a poco); el del día, cuando abre el horario del día siguiente.
 */
export function paceDecision(policy: SendPolicy, counts: LaneCounts, now: Date, timeZone: string): PaceDecision {
  if (!isInWindow(policy.window, now, timeZone)) {
    return { ok: false, reason: "window", retryAt: nextWindowOpen(policy.window, now, timeZone) };
  }
  if (policy.perDay !== null && counts.today >= policy.perDay) {
    return { ok: false, reason: "day", retryAt: nextWindowOpen(policy.window, startOfNextDay(now, timeZone), timeZone) };
  }
  if (policy.perHour !== null && counts.lastHour >= policy.perHour) {
    return { ok: false, reason: "hour", retryAt: new Date(now.getTime() + 5 * 60_000) };
  }
  if (policy.perMinute !== null && counts.lastMinute >= policy.perMinute) {
    return { ok: false, reason: "minute", retryAt: new Date(now.getTime() + 15_000) };
  }
  return { ok: true };
}

export const PACE_BLOCK_LABELS: Record<PaceBlock, string> = {
  window: "fuera del horario de envío",
  minute: "llegó al tope por minuto",
  hour: "llegó al tope por hora",
  day: "llegó al tope del día",
};

/** Mensajes por hora que permite el ritmo, sin contar el horario ni el tope diario. */
export function hourlyRate(policy: SendPolicy): number {
  const avgGap = (policy.minGapSeconds + policy.maxGapSeconds) / 2;
  const byGap = avgGap > 0 ? 3600 / avgGap : Infinity;
  const byMinute = policy.perMinute !== null ? policy.perMinute * 60 : Infinity;
  const byHour = policy.perHour ?? Infinity;
  return Math.min(byGap, byMinute, byHour);
}

/**
 * Cuándo terminaría de salir `pending` mensajes a este ritmo (aproximado: usa la
 * espera promedio). null si no termina en un año (un ritmo imposible).
 */
export function estimateFinish(pending: number, policy: SendPolicy, now: Date, timeZone: string, sentToday = 0): Date | null {
  if (pending <= 0) return now;
  const rate = hourlyRate(policy);
  if (!Number.isFinite(rate)) return now;
  if (rate <= 0) return null;

  const STEP_MIN = 15;
  const perStep = rate * (STEP_MIN / 60);
  let t = now;
  let remaining = pending;
  let dayKey = civilKey(t, timeZone);
  let dayCount = sentToday;
  const limit = now.getTime() + 366 * 24 * 3600_000;

  while (remaining > 0) {
    if (t.getTime() > limit) return null;
    if (!isInWindow(policy.window, t, timeZone)) t = nextWindowOpen(policy.window, t, timeZone);
    const key = civilKey(t, timeZone);
    if (key !== dayKey) {
      dayKey = key;
      dayCount = 0;
    }
    const dayLeft = policy.perDay === null ? Infinity : policy.perDay - dayCount;
    if (dayLeft <= 0) {
      t = nextWindowOpen(policy.window, startOfNextDay(t, timeZone), timeZone);
      continue;
    }
    const take = Math.min(remaining, perStep, dayLeft);
    if (take >= remaining) return new Date(t.getTime() + (take / perStep) * STEP_MIN * 60_000);
    remaining -= take;
    dayCount += take;
    t = new Date(t.getTime() + STEP_MIN * 60_000);
  }
  return t;
}

function civilKey(d: Date, timeZone: string): string {
  const { year, month, day } = civilDate(d, timeZone);
  return `${year}-${month}-${day}`;
}

const DAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** Los días en corto, juntando los seguidos: [1..6] → "Lun a Sáb". */
export function describeDays(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return "Todos los días";
  const runs: number[][] = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && d === last[last.length - 1] + 1) last.push(d);
    else runs.push([d]);
  }
  return runs.map((r) => (r.length >= 3 ? `${DAY_SHORT[r[0]]} a ${DAY_SHORT[r[r.length - 1]]}` : r.map((d) => DAY_SHORT[d]).join(", "))).join(", ");
}

/** El ritmo en una línea, para la pantalla. */
export function describePolicy(p: SendPolicy): string {
  const parts: string[] = [];
  if (p.maxGapSeconds > 0) parts.push(p.minGapSeconds === p.maxGapSeconds ? `${p.minGapSeconds} s entre mensajes` : `${p.minGapSeconds}–${p.maxGapSeconds} s entre mensajes`);
  if (p.perMinute !== null) parts.push(`máx. ${p.perMinute}/min`);
  if (p.perHour !== null) parts.push(`${p.perHour}/hora`);
  if (p.perDay !== null) parts.push(`${p.perDay}/día`);
  parts.push(p.window.enabled ? `${describeDays(p.window.days)} de ${p.window.start} a ${p.window.end}` : "a cualquier hora");
  return parts.join(" · ");
}
