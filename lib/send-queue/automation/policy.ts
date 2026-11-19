/**
 * El ritmo de la cola de WhatsApp de un número (traída de RER-BAIOS, 18/11/2026). PURO.
 *
 * Decisión de Wendy (18/11/2026): la cola usa el MISMO ritmo que ya tiene el número para los broadcasts
 * (`channels.send_policy`; sin guardar, `DEFAULT_WHATSAPP_POLICY`), no el de RER (120/h y 600/día era el doble). Encima
 * de ese techo, la cola suma:
 *   - la reserva para lo urgente (`urgentReservePct`, 20 % por defecto): lo normal y lo masivo, broadcasts incluidos,
 *     usan como mucho el cupo de la hora menos la reserva;
 *   - el calentamiento de un número nuevo: una escalera de tramos («N días al X %») que arranca cuando se conectó el
 *     número (`channels.created_at`) o cuando alguien tocó «volver a calentar» (`warmupFrom`). Sin escalera guardada, un
 *     solo tramo: la primera semana a la mitad. Solo baja los topes de la hora y del día: la espera y el minuto no cambian.
 *
 * Estas claves viven en la misma fila (`channels.send_policy`). Guardar el ritmo desde Canales NO las pisa
 * (`mergeQueueKeys`).
 */
import { DEFAULT_WHATSAPP_POLICY, parsePolicy, type SendPolicy } from "@/lib/send-queue/pace";

export interface QueuePolicy extends SendPolicy {
  /** Porcentaje del cupo por hora reservado para lo urgente. */
  urgentReservePct: number;
  /** Días que un número cuenta como nuevo (un solo tramo, si no hay escalera). */
  newNumberDays: number;
  /** El factor de sus topes por hora y por día mientras es nuevo (0,5 = la mitad). */
  newNumberFactor: number;
  /** La escalera de calentamiento, en orden. Vacía = la de un tramo con `newNumberDays` y `newNumberFactor`. */
  warmupSteps: WarmupStep[];
  /** Desde cuándo cuenta el calentamiento («volver a calentar»). Null = desde `channels.created_at`. */
  warmupFrom: string | null;
}

/** Un tramo del calentamiento: `days` días con los topes de la hora y del día por `factor`. */
export interface WarmupStep {
  days: number;
  factor: number;
}

/** Dónde está el número en su calentamiento ahora (null = ya calentó o no hay calentamiento). */
export interface WarmupState {
  /** Día del calentamiento, desde 1. */
  day: number;
  totalDays: number;
  stepIndex: number;
  factor: number;
}

export const MAX_WARMUP_STEPS = 10;

/** Las claves propias de la cola dentro de `channels.send_policy` (las que guardar el ritmo no puede pisar). */
export const QUEUE_POLICY_KEYS = ["urgentReservePct", "newNumberDays", "newNumberFactor", "warmupSteps", "warmupFrom"] as const;

export const DEFAULT_QUEUE_EXTRAS = {
  urgentReservePct: 20,
  newNumberDays: 7,
  newNumberFactor: 0.5,
  warmupSteps: [] as WarmupStep[],
  warmupFrom: null as string | null,
};

export const DEFAULT_QUEUE_POLICY: QueuePolicy = { ...DEFAULT_WHATSAPP_POLICY, ...DEFAULT_QUEUE_EXTRAS };

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function clampFactor(f: number): number {
  return Math.min(1, Math.max(0.1, Math.round(f * 100) / 100));
}

/** El ritmo de la cola de un número: lo guardado sobre el ritmo de siempre de WhatsApp. Nunca lanza. */
export function parseQueuePolicy(raw: unknown): QueuePolicy {
  const base = parsePolicy(raw, DEFAULT_WHATSAPP_POLICY);
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const reserve = num(p.urgentReservePct);
  const days = num(p.newNumberDays);
  const factor = num(p.newNumberFactor);
  return {
    ...base,
    urgentReservePct: reserve === null ? DEFAULT_QUEUE_EXTRAS.urgentReservePct : Math.min(90, Math.max(0, Math.round(reserve))),
    newNumberDays: days === null ? DEFAULT_QUEUE_EXTRAS.newNumberDays : Math.min(60, Math.max(0, Math.round(days))),
    newNumberFactor: factor === null ? DEFAULT_QUEUE_EXTRAS.newNumberFactor : clampFactor(factor),
    warmupSteps: parseWarmupSteps(p.warmupSteps),
    warmupFrom: typeof p.warmupFrom === "string" && Number.isFinite(Date.parse(p.warmupFrom)) ? new Date(p.warmupFrom).toISOString() : null,
  };
}

/** La escalera guardada, limpia: tramos con días de 1 a 60 y factor de 0,1 a 1. Lo raro se ignora. */
export function parseWarmupSteps(raw: unknown): WarmupStep[] {
  if (!Array.isArray(raw)) return [];
  const out: WarmupStep[] = [];
  for (const r of raw.slice(0, MAX_WARMUP_STEPS)) {
    if (!r || typeof r !== "object") continue;
    const d = num((r as Record<string, unknown>).days);
    const f = num((r as Record<string, unknown>).factor);
    if (d === null || f === null || d < 1) continue;
    out.push({ days: Math.min(60, Math.round(d)), factor: clampFactor(f) });
  }
  return out;
}

/**
 * Lo que se guarda al cambiar el ritmo desde Canales: el ritmo nuevo + las claves de la cola que ya estaban (la reserva y
 * el calentamiento no se pierden por guardar la espera o los topes).
 */
export function mergeQueueKeys(policy: SendPolicy, previousRaw: unknown): Record<string, unknown> {
  const prev = previousRaw && typeof previousRaw === "object" && !Array.isArray(previousRaw) ? (previousRaw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...policy };
  for (const k of QUEUE_POLICY_KEYS) if (k in prev) out[k] = prev[k];
  return out;
}

/** La escalera que vale: la guardada o, sin ella, un tramo con los valores de «número nuevo». */
export function warmupStepsOf(policy: Pick<QueuePolicy, "warmupSteps" | "newNumberDays" | "newNumberFactor">): WarmupStep[] {
  if (policy.warmupSteps.length > 0) return policy.warmupSteps;
  return policy.newNumberDays > 0 ? [{ days: policy.newNumberDays, factor: policy.newNumberFactor }] : [];
}

/** En qué tramo del calentamiento está el número ahora. `since`: cuándo se conectó (lo pisa `warmupFrom`). */
export function warmupState(
  policy: Pick<QueuePolicy, "warmupSteps" | "warmupFrom" | "newNumberDays" | "newNumberFactor">,
  since: Date | null,
  now: Date,
): WarmupState | null {
  const start = policy.warmupFrom ? new Date(policy.warmupFrom) : since;
  if (!start) return null;
  const elapsed = now.getTime() - start.getTime();
  if (elapsed < 0) return null;
  const steps = warmupStepsOf(policy);
  const totalDays = steps.reduce((a, s) => a + s.days, 0);
  const dayIdx = Math.floor(elapsed / (24 * 3600_000));
  let acc = 0;
  for (let i = 0; i < steps.length; i++) {
    acc += steps[i].days;
    if (dayIdx < acc) return { day: dayIdx + 1, totalDays, stepIndex: i, factor: steps[i].factor };
  }
  return null;
}

/** Los topes que valen ahora: en calentamiento, la hora y el día por el factor de su tramo (al menos 1). */
export function effectiveQueuePolicy(policy: QueuePolicy, since: Date | null, now: Date): QueuePolicy {
  const w = warmupState(policy, since, now);
  if (!w || w.factor >= 1) return policy;
  const scale = (v: number | null) => (v === null ? null : Math.max(1, Math.floor(v * w.factor)));
  return { ...policy, perHour: scale(policy.perHour), perDay: scale(policy.perDay) };
}

/** El texto del calentamiento para la tarjeta del número (null = ya calentó). */
export function warmupLabel(policy: QueuePolicy, since: Date | null, now: Date): string | null {
  const w = warmupState(policy, since, now);
  if (!w || w.factor >= 1) return null;
  return `calentando: día ${w.day} de ${w.totalDays}, cupos al ${Math.round(w.factor * 100)} %`;
}

/** Lo que llega de la pantalla para la escalera: hasta 10 tramos, días de 1 a 60 y porcentaje de 10 a 100. */
export function warmupStepsInput(input: unknown): { ok: true; value: WarmupStep[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "Faltan los tramos del calentamiento." };
  if (input.length > MAX_WARMUP_STEPS) return { ok: false, error: `Como mucho ${MAX_WARMUP_STEPS} tramos.` };
  const out: WarmupStep[] = [];
  for (const [i, r] of input.entries()) {
    const days = num((r as Record<string, unknown> | null)?.days);
    const pct = num((r as Record<string, unknown> | null)?.pct);
    if (days === null || !Number.isInteger(days) || days < 1 || days > 60) return { ok: false, error: `Tramo ${i + 1}: los días van de 1 a 60.` };
    if (pct === null || !Number.isInteger(pct) || pct < 10 || pct > 100) return { ok: false, error: `Tramo ${i + 1}: el porcentaje va de 10 a 100.` };
    out.push({ days, factor: pct / 100 });
  }
  return { ok: true, value: out };
}
