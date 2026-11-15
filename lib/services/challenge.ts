// @plantilla-quitar(servicios)
/**
 * Reto genérico (F127, decisión 470), puro. Cada función es gemela de una de `app_servicio` (00376) y comparte
 * `challenge.cases.json` con ella (vitest acá; verify-services --bloque a3 contra la base):
 *
 * - `recurrenceWindow` ↔ `svc_recurrence_window`   desde y hasta cuándo se repite un paso (anclas de F127.2)
 * - `latePlan`         ↔ `svc_late_plan`           si una repetición se puede cargar ahora (F127.3)
 * - `challengeWeeks`   ↔ `svc_challenge_weeks_plan` el control semanal (F127.5, con el campo «trabado»)
 * - `startByDate`      ↔ `svc_challenge_start_by`  la fecha límite para empezar (F127.6)
 * - `certificateTemplatePick` ↔ (solo TS: emitir el certificado es código) la plantilla según si llegó a tiempo (F127.7)
 *
 * Fechas civiles `YYYY-MM-DD`; horas locales `YYYY-MM-DDTHH:MM:SS` en la zona del estudiante.
 */
import { addDays } from "./engine-rules";

// ── F127.2 · Anclas de las repeticiones ────────────────────────────────────
export const RECUR_FROM = ["service_created", "service_start", "phase_start", "phase_end", "item_completed"] as const;
export const RECUR_UNTIL = ["phase_end", "service_end", "n_days", "n_times", "item_completed"] as const;

export interface WindowAnchors {
  serviceCreated?: string | null;
  serviceStart?: string | null;
  serviceEnd?: string | null;
  /** Inicio de SU fase (la del paso). */
  phaseStart?: string | null;
  /** Fin planeado de SU fase (inicio + duración − 1) o null si no tiene duración. */
  phaseEnd?: string | null;
  /** Otras fases por clave: inicio real y fin (real si terminó). */
  phases?: Record<string, { start?: string | null; end?: string | null }>;
  /** Pasos por clave: cuándo se completaron. */
  items?: Record<string, string | null>;
}
export interface RecurrenceWindow {
  /** null = todavía no se sabe desde cuándo (el ancla no llegó): no se crea ninguna repetición. */
  start: string | null;
  /** null = sin fecha de fin (lo cortan n_times o la fase). */
  until: string | null;
}

function anchorDate(from: unknown, phaseKey: unknown, a: WindowAnchors, itemKey: unknown): string | null {
  const other = typeof phaseKey === "string" && phaseKey ? a.phases?.[phaseKey] : undefined;
  switch (from) {
    case "service_created":
      return a.serviceCreated ?? null;
    case "service_start":
      return a.serviceStart ?? null;
    case "phase_start":
      return typeof phaseKey === "string" && phaseKey ? other?.start ?? null : a.phaseStart ?? null;
    case "phase_end":
      return typeof phaseKey === "string" && phaseKey ? other?.end ?? null : a.phaseEnd ?? null;
    case "item_completed":
      return typeof itemKey === "string" ? a.items?.[itemKey] ?? null : null;
    default:
      return null;
  }
}

/**
 * Desde y hasta cuándo se repite. Sin `from`, desde el inicio de su fase (como siempre). `until` con `n_days` cuenta
 * desde el inicio; `max_days` es un tope extra para cualquier `until` (p. ej. «hasta la Entrega final, máximo 30 días»).
 */
export function recurrenceWindow(r: Record<string, unknown>, a: WindowAnchors): RecurrenceWindow {
  const from = r.from && typeof r.from === "object" ? (r.from as Record<string, unknown>) : null;
  let start: string | null;
  if (!from) start = a.phaseStart ?? null;
  else {
    const base = anchorDate(from.from, from.phase_key, a, from.item_key);
    const days = typeof from.days === "number" && Number.isInteger(from.days) ? from.days : 0;
    start = base ? addDays(base, days) : null;
    // Las anclas de siempre (sin `phase_key`) sin fecha arrancan con su fase, como antes de F127.
    const legacy = (from.from === "service_created" || from.from === "service_start" || from.from === "phase_start") && !(typeof from.phase_key === "string" && from.phase_key);
    if (!start && legacy) start = a.phaseStart ?? null;
  }
  if (!start) return { start: null, until: null };
  let until: string | null;
  switch (r.until) {
    case "phase_end":
      until = typeof r.phase_key === "string" && r.phase_key ? a.phases?.[r.phase_key]?.end ?? null : a.phaseEnd ?? null;
      break;
    case "service_end":
      until = a.serviceEnd ?? null;
      break;
    case "n_days":
      until = addDays(start, Math.max(1, typeof r.n_until === "number" ? r.n_until : 1) - 1);
      break;
    case "item_completed":
      until = typeof r.item_key === "string" ? a.items?.[r.item_key] ?? null : null;
      break;
    default:
      until = null;
  }
  if (typeof r.max_days === "number" && Number.isInteger(r.max_days) && r.max_days >= 1) {
    const cap = addDays(start, r.max_days - 1);
    if (!until || cap < until) until = cap;
  }
  return { start, until };
}

// ── F127.3 · Adelantar y días pasados ──────────────────────────────────────
export interface LateConfig {
  accept?: boolean;
  early?: boolean;
  grace_hours?: number;
  grace_days?: number;
  counts?: unknown;
  message?: unknown;
}
export type LatePlan = { ok: true; late: boolean } | { ok: false; code: "SV035" | "SV036"; message: string };
export const LATE_MESSAGES = { SV035: "Todavía no se puede cargar", SV036: "Ya pasó el plazo para cargarlo" } as const;

const toMs = (local: string) => Date.parse(`${local.length === 10 ? `${local}T00:00:00` : local}Z`);

/**
 * Si una repetición se puede completar ahora (`now` en hora local del estudiante). Sin `late` configurado, como
 * siempre: se completa en cualquier momento. Con `late`: no se adelanta (salvo `early`), vence al terminar `dueOn`
 * más `grace_hours`, y después solo con `accept` (hasta `grace_days` días más, si está).
 */
export function latePlan(late: LateConfig | null | undefined, occursOn: string, dueOn: string, now: string): LatePlan {
  if (!late || typeof late !== "object") return { ok: true, late: false };
  if (late.early !== true && now.slice(0, 10) < occursOn) return { ok: false, code: "SV035", message: LATE_MESSAGES.SV035 };
  const gh = typeof late.grace_hours === "number" && late.grace_hours > 0 ? late.grace_hours : 0;
  const deadline = toMs(addDays(dueOn, 1)) + gh * 3600_000;
  const t = toMs(now);
  if (t < deadline) return { ok: true, late: false };
  if (late.accept !== true) return { ok: false, code: "SV036", message: LATE_MESSAGES.SV036 };
  const gd = typeof late.grace_days === "number" && Number.isInteger(late.grace_days) && late.grace_days >= 0 ? late.grace_days : null;
  if (gd !== null && t >= deadline + gd * 86400_000) return { ok: false, code: "SV036", message: LATE_MESSAGES.SV036 };
  return { ok: true, late: true };
}

// ── F127.5 · Control semanal ───────────────────────────────────────────────
export interface WeekRow {
  on: string;
  number?: number | null;
  link?: string | null;
  stuck?: string | null;
}
export interface WeekInput {
  startOn: string;
  today: string;
  /** Días del reto (la duración de la fase); null = hasta la semana de hoy. */
  days: number | null;
  min: number | null;
  video: boolean;
  rows: WeekRow[];
}
export interface WeekView {
  week: number;
  from: string;
  to: string;
  total: number;
  /** Hubo un link esa semana. */
  video: boolean;
  /** Ya terminó y quedó por debajo del mínimo (o sin video, si se pide). */
  below: boolean;
  missingVideo: boolean;
  current: boolean;
  future: boolean;
  stuck: Array<{ on: string; text: string }>;
}

/** Semanas contadas desde el día 1 del reto (no del calendario). La semana corta del final no tiene mínimo. */
export function challengeWeeks(i: WeekInput): WeekView[] {
  const lastDay = i.days && i.days > 0 ? addDays(i.startOn, i.days - 1) : i.today < i.startOn ? i.startOn : i.today;
  const out: WeekView[] = [];
  for (let w = 1; w <= 200; w++) {
    const from = addDays(i.startOn, (w - 1) * 7);
    if (from > lastDay) break;
    let to = addDays(from, 6);
    const short = to > lastDay;
    if (short) to = lastDay;
    const rows = i.rows.filter((r) => r.on >= from && r.on <= to);
    const total = Math.round(rows.reduce((s, r) => s + (typeof r.number === "number" && Number.isFinite(r.number) ? r.number : 0), 0) * 100) / 100;
    const video = rows.some((r) => typeof r.link === "string" && r.link.trim() !== "");
    const finished = i.today > to;
    const missingVideo = i.video && !short && finished && !video;
    const belowMin = !short && finished && typeof i.min === "number" && i.min > 0 && total < i.min;
    out.push({
      week: w,
      from,
      to,
      total,
      video,
      below: belowMin || missingVideo,
      missingVideo,
      current: i.today >= from && i.today <= to,
      future: i.today < from,
      stuck: rows.filter((r) => typeof r.stuck === "string" && r.stuck.trim() !== "").map((r) => ({ on: r.on, text: (r.stuck as string).trim() })),
    });
  }
  return out;
}

// ── F127.6 · Fecha límite para empezar ─────────────────────────────────────
export function startByDate(startBy: unknown, serviceStart: string | null, serviceCreated: string | null): string | null {
  if (!startBy || typeof startBy !== "object") return null;
  const s = startBy as Record<string, unknown>;
  const base = s.from === "service_created" ? serviceCreated : s.from === "service_start" ? serviceStart : null;
  if (!base || !(typeof s.days === "number" && Number.isInteger(s.days) && s.days >= 0)) return null;
  return addDays(base, s.days);
}

// ── F127.7 · Certificado según si llegó a tiempo ───────────────────────────
export interface CertificateChoice {
  if?: "on_time";
  item_key?: string;
  else?: true;
  template_id: string;
}
/** La plantilla del certificado. `onTime[item_key]` = ese paso se completó dentro de su plazo (sin gracia). */
export function certificateTemplatePick(ref: Record<string, unknown>, onTime: Record<string, boolean>): string | null {
  const list = Array.isArray(ref.templates) ? (ref.templates as CertificateChoice[]) : null;
  if (!list) return typeof ref.template_id === "string" ? ref.template_id : null;
  for (const c of list) {
    if (c && c.if === "on_time" && typeof c.item_key === "string" && onTime[c.item_key] === true) return c.template_id;
  }
  const fallback = list.find((c) => c && c.else === true);
  return fallback?.template_id ?? (typeof ref.template_id === "string" ? ref.template_id : null);
}

/**
 * Si un paso se completó dentro de su plazo, sin días ni horas de gracia (F127.7). Con `dueOn`, alcanza con haberlo
 * completado ese día o antes en la zona del negocio; sin `dueOn`, contra `dueAt`; sin plazo, cuenta como a tiempo.
 */
export function itemOnTime(i: { completedAt: string | null; dueOn: string | null; dueAt: string | null; timeZone: string }): boolean {
  if (!i.completedAt) return false;
  const done = new Date(i.completedAt);
  if (Number.isNaN(done.getTime())) return false;
  if (i.dueOn) return new Intl.DateTimeFormat("en-CA", { timeZone: i.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(done) <= i.dueOn;
  if (i.dueAt) return done.getTime() <= new Date(i.dueAt).getTime();
  return true;
}
