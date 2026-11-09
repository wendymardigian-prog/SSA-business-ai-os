// @plantilla-quitar(servicios)
/**
 * Las fechas de una sesión del calendario (F59), puro. Gemela de `app_servicio.live_occurrences_plan(jsonb)` (00346);
 * los casos de `occurrences.cases.json` corren contra las dos. Las fechas se arman en la ZONA DE LA SESIÓN (la clase
 * de las 19:00 de Costa Rica es a las 19:00 de Costa Rica aunque el servidor esté en UTC) y nunca se guardan: solo
 * las excepciones (cancelada, movida, con grabación) viven en `live_session_dates`.
 */
import { addDays, dateInTz, wallClockToUtc } from "@/lib/scheduling/time/tz";
import type { DateString, WallTime } from "@/lib/scheduling/types";

export interface LiveSessionShape {
  kind: "weekly" | "single";
  /** 1 = lunes … 7 = domingo. */
  weekdays: number[] | null;
  every_weeks: number | null;
  starts_on: string | null;
  ends_on: string | null;
  single_at: string | null;
  start_time: string | null;
  duration_minutes: number;
  timezone: string;
}

export interface LiveDateException {
  occurs_on: string;
  status: "normal" | "cancelled" | "moved";
  moved_to: string | null;
}

export interface Occurrence {
  occursOn: string;
  startsAt: string;
  endsAt: string;
  status: "normal" | "cancelled" | "moved";
}

const isoDow = (d: string) => {
  const w = new Date(`${d}T12:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
};
const mondayOf = (d: string) => addDays(d as DateString, 1 - isoDow(d)) as string;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function occurrences(s: LiveSessionShape, exceptions: LiveDateException[], from: string, to: string): Occurrence[] {
  const byDate = new Map(exceptions.map((e) => [e.occurs_on, e]));
  const out: Occurrence[] = [];
  const push = (occursOn: string, startUtc: Date) => {
    const ex = byDate.get(occursOn);
    const start = ex?.status === "moved" && ex.moved_to ? new Date(ex.moved_to) : startUtc;
    out.push({
      occursOn,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + s.duration_minutes * 60_000).toISOString(),
      status: ex?.status ?? "normal",
    });
  };
  if (s.kind === "single") {
    if (!s.single_at) return [];
    const day = dateInTz(s.single_at, s.timezone) as string;
    if (day >= from && day <= to) push(day, new Date(s.single_at));
    return out;
  }
  if (!s.starts_on || !s.start_time || !s.weekdays?.length) return [];
  const every = Math.min(4, Math.max(1, s.every_weeks ?? 1));
  const anchor = mondayOf(s.starts_on);
  let d = from > s.starts_on ? from : s.starts_on;
  const last = s.ends_on && s.ends_on < to ? s.ends_on : to;
  while (d <= last) {
    if (s.weekdays.includes(isoDow(d)) && Math.floor(daysBetween(anchor, d) / 7) % every === 0) {
      push(d, wallClockToUtc(d as DateString, s.start_time.slice(0, 5) as WallTime, s.timezone));
    }
    d = addDays(d as DateString, 1) as string;
  }
  return out;
}

/** La ventana de asistencia (F61): de 10 minutos antes del inicio a 30 después del final. */
export function inAttendanceWindow(startsAt: string, endsAt: string, at: string): boolean {
  const t = Date.parse(at);
  return t >= Date.parse(startsAt) - 10 * 60_000 && t <= Date.parse(endsAt) + 30 * 60_000;
}

export type AttendanceBase = { type: "active" } | { type: "started_within"; days: number } | { type: "phase"; phase_key: string } | { type: "variant"; variant_id: string };

export interface BaseMember {
  /** Tiene el acceso Calendario vigente ese día. */
  calendarAccess: boolean;
  variantId: string | null;
  serviceStartsOn: string | null;
  /** La fase del camino en la que estaba ese día. */
  phaseKeyOnDate: string | null;
}

/** Si una persona entra en la base de una sesión en una fecha (F61). Siempre necesita el acceso y que la sesión sea de su variante. */
export function inAttendanceBase(base: AttendanceBase, sessionVariantIds: string[] | null, m: BaseMember, occursOn: string): boolean {
  if (!m.calendarAccess) return false;
  if (sessionVariantIds && (!m.variantId || !sessionVariantIds.includes(m.variantId))) return false;
  switch (base.type) {
    case "active":
      return true;
    case "started_within":
      return !!m.serviceStartsOn && m.serviceStartsOn <= occursOn && daysBetween(m.serviceStartsOn, occursOn) <= base.days;
    case "phase":
      return m.phaseKeyOnDate === base.phase_key;
    case "variant":
      return m.variantId === base.variant_id;
    default:
      return false;
  }
}

/** El promedio de una sesión: asistentes DE LA BASE sobre el tamaño de la base. Base vacía = null («—», nunca 0 %). */
export function attendancePct(baseIds: string[], attendedIds: string[]): number | null {
  if (baseIds.length === 0) return null;
  const set = new Set(attendedIds);
  return Math.round((baseIds.filter((id) => set.has(id)).length / baseIds.length) * 100);
}

export function attendanceBaseIssues(base: unknown): string[] {
  const b = (base && typeof base === "object" ? base : {}) as Record<string, unknown>;
  switch (b.type) {
    case "active":
      return [];
    case "started_within":
      return Number.isInteger(b.days) && (b.days as number) >= 1 && (b.days as number) <= 365 ? [] : ["los días van de 1 a 365"];
    case "phase":
      return typeof b.phase_key === "string" && /^ph_[a-z0-9]{6}$/.test(b.phase_key) ? [] : ["elegí la fase"];
    case "variant":
      return typeof b.variant_id === "string" && /^[0-9a-f-]{36}$/i.test(b.variant_id) ? [] : ["elegí la variante"];
    default:
      return ["elegí sobre quiénes se mide"];
  }
}
