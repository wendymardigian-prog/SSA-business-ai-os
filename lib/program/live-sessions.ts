// @plantilla-quitar(servicios)
/**
 * El formulario de una sesión en vivo (F58), puro. Lo que pide `live_sessions_shape_check` y los demás CHECK de la
 * 00346, dicho en castellano antes de llegar a la base. Lo llaman la pantalla y la acción `saveLiveSession`.
 */
import { attendanceBaseIssues, type AttendanceBase } from "@/lib/program/occurrences";

export interface LiveSessionInput {
  title: string;
  kind: "weekly" | "single";
  weekdays?: number[];
  everyWeeks?: number;
  startsOn?: string;
  endsOn?: string | null;
  /** Suelta: fecha y hora de pared en la zona de la sesión ("2026-11-20T19:00"). */
  singleLocal?: string;
  startTime?: string;
  durationMinutes: number;
  timezone: string;
  variantIds?: string[] | null;
  hostUserId?: string | null;
  meetingUrl?: string | null;
  keyword?: string | null;
  trackClicks?: boolean;
  clickCountsAsAttendance?: boolean;
  attendanceBase?: AttendanceBase;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const WEEKDAY_LABELS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;

/** Problemas del formulario, en el orden en que se ven. Vacío = se puede guardar. */
export function liveSessionIssues(i: LiveSessionInput): string[] {
  const out: string[] = [];
  const title = (i.title ?? "").trim();
  if (!title) out.push("Escribí el título");
  else if (title.length > 120) out.push("El título tiene hasta 120 caracteres");
  if (i.kind === "weekly") {
    const days = i.weekdays ?? [];
    if (!days.length) out.push("Elegí al menos un día");
    else if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) out.push("Los días van de lunes a domingo");
    if (!Number.isInteger(i.everyWeeks) || (i.everyWeeks as number) < 1 || (i.everyWeeks as number) > 4) out.push("La frecuencia va de cada 1 a cada 4 semanas");
    if (!i.startsOn || !DATE.test(i.startsOn)) out.push("Elegí desde qué día");
    if (!i.startTime || !TIME.test(i.startTime)) out.push("Elegí la hora");
    if (i.endsOn && (!DATE.test(i.endsOn) || (i.startsOn && i.endsOn < i.startsOn))) out.push("El último día no puede ser antes del primero");
  } else if (i.kind === "single") {
    if (!i.singleLocal || !LOCAL.test(i.singleLocal)) out.push("Elegí el día y la hora");
  } else out.push("Elegí si es semanal o suelta");
  if (!Number.isInteger(i.durationMinutes) || i.durationMinutes < 5 || i.durationMinutes > 720) out.push("La duración va de 5 minutos a 12 horas");
  if (!i.timezone?.trim()) out.push("Elegí la zona horaria");
  const url = (i.meetingUrl ?? "").trim();
  if (url && !/^https:\/\/\S+$/.test(url)) out.push("El link de la reunión empieza con https://");
  if (i.variantIds && (i.variantIds.length === 0 || i.variantIds.some((v) => !UUID.test(v)))) out.push("Elegí al menos una variante, o «todas»");
  if (i.hostUserId && !UUID.test(i.hostUserId)) out.push("El anfitrión no es válido");
  out.push(...attendanceBaseIssues(i.attendanceBase ?? { type: "active" }).map((s) => s.charAt(0).toUpperCase() + s.slice(1)));
  return out;
}

/** Lo que recibe `app_servicio.live_session_save`. La hora suelta pasa de la zona de la sesión a UTC con `toUtc`. */
export function liveSessionPayload(i: LiveSessionInput, toUtc: (localDateTime: string, timezone: string) => string): Record<string, unknown> {
  const weekly = i.kind === "weekly";
  return {
    title: i.title.trim(),
    kind: i.kind,
    weekdays: weekly ? [...new Set(i.weekdays ?? [])].sort((a, b) => a - b) : null,
    every_weeks: weekly ? i.everyWeeks : null,
    starts_on: weekly ? i.startsOn : null,
    ends_on: weekly ? i.endsOn || null : null,
    single_at: weekly ? null : toUtc(i.singleLocal as string, i.timezone),
    start_time: weekly ? i.startTime : null,
    duration_minutes: i.durationMinutes,
    timezone: i.timezone.trim(),
    variant_ids: i.variantIds ?? null,
    host_user_id: i.hostUserId || null,
    meeting_url: (i.meetingUrl ?? "").trim() || null,
    keyword: (i.keyword ?? "").trim() || null,
    track_clicks: i.trackClicks ?? true,
    click_counts_as_attendance: i.clickCountsAsAttendance ?? false,
    attendance_base: i.attendanceBase ?? { type: "active" },
  };
}

/** Una línea para la lista: «Martes y jueves 19:00 (America/Costa_Rica), cada semana». */
export function liveSessionSummary(s: { kind: string; weekdays: number[] | null; every_weeks: number | null; start_time: string | null; timezone: string; single_at: string | null }, formatSingle: (iso: string) => string): string {
  if (s.kind === "single") return s.single_at ? `${formatSingle(s.single_at)} (${s.timezone})` : "Sin fecha";
  const days = (s.weekdays ?? []).map((d) => WEEKDAY_LABELS[d - 1]).filter(Boolean);
  const list = days.length <= 1 ? days.join("") : `${days.slice(0, -1).join(", ")} y ${days[days.length - 1]}`;
  const every = !s.every_weeks || s.every_weeks === 1 ? "cada semana" : `cada ${s.every_weeks} semanas`;
  const time = (s.start_time ?? "").slice(0, 5);
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} ${time} (${s.timezone}), ${every}`;
}

/** Problemas al cambiar UNA fecha: mover pide la fecha nueva; una grabación es un link https o una grabación elegida. */
export function liveDateIssues(p: { status?: string; movedToLocal?: string | null; recordingUrl?: string | null }): string[] {
  const out: string[] = [];
  if (p.status === "moved" && (!p.movedToLocal || !LOCAL.test(p.movedToLocal))) out.push("Elegí el día y la hora nuevos");
  if (p.recordingUrl && !/^https:\/\/\S+$/.test(p.recordingUrl.trim())) out.push("El link de la grabación empieza con https://");
  return out;
}
