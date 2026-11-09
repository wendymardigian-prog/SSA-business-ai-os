// @plantilla-quitar(servicios)
/**
 * Lo que dibuja el Calendario del programa (F62), puro. La pantalla solo compone. Todo sale de
 * `app_servicio.live_attendance_overview` (una fila por fecha pasada, con su base, sus asistencias y sus clics) y de
 * `live_session_occurrences` (las próximas).
 *
 * Regla de la métrica (F61): el promedio es asistentes DE LA BASE / tamaño de la base. Quien asiste fuera de la base
 * queda registrado, pero no suma ni resta. Una base vacía es «—», nunca 0 %.
 */

export interface OverviewAttendance {
  id: string;
  contact_id: string;
  source: "self" | "team" | "click";
  added_manually: boolean;
}

export interface OverviewDate {
  live_session_id: string;
  occurs_on: string;
  starts_at: string;
  ends_at: string;
  status: "normal" | "cancelled" | "moved";
  base: string[];
  attended: OverviewAttendance[];
  clicks: Array<{ contact_id: string | null; clicked_at: string }>;
}

export interface DateRecording {
  recording_url: string | null;
  recording_call_id: string | null;
  recording_active: boolean;
}

export type AttendanceCell =
  | { state: "self"; label: "Asistió" }
  | { state: "team"; label: "Asistió (equipo)" }
  | { state: "clicked"; label: string; clickedAt: string }
  | { state: "absent"; label: "No asistió" }
  | { state: "no_access"; label: "·" };

/** La celda de un estudiante en una fecha. `formatTime` da la hora de pared de quien mira («19:02»). */
export function attendanceCell(d: OverviewDate, contactId: string, formatTime: (iso: string) => string): AttendanceCell {
  const a = d.attended.find((x) => x.contact_id === contactId);
  if (a) return a.source === "team" ? { state: "team", label: "Asistió (equipo)" } : { state: "self", label: "Asistió" };
  if (!d.base.includes(contactId)) return { state: "no_access", label: "·" };
  const click = d.clicks.filter((c) => c.contact_id === contactId).sort((x, y) => x.clicked_at.localeCompare(y.clicked_at))[0];
  if (click) return { state: "clicked", label: `Hizo clic ${formatTime(click.clicked_at)}`, clickedAt: click.clicked_at };
  return { state: "absent", label: "No asistió" };
}

/** Asistentes de la base de una fecha, y el tamaño de la base. */
export function baseCounts(d: OverviewDate): { attended: number; base: number } {
  const base = new Set(d.base);
  const attended = new Set(d.attended.filter((a) => base.has(a.contact_id)).map((a) => a.contact_id));
  return { attended: attended.size, base: base.size };
}

/** Clics de personas que no tienen asistencia esa fecha (sin repetir personas). */
export function unconfirmedClicks(d: OverviewDate): number {
  const attended = new Set(d.attended.map((a) => a.contact_id));
  return new Set(d.clicks.map((c) => c.contact_id).filter((c): c is string => !!c && !attended.has(c))).size;
}

export function hasRecording(r: DateRecording | null | undefined): boolean {
  return !!r && (!!r.recording_url || !!r.recording_call_id);
}

/** «19 de 24 · 2 clics sin confirmar · Sin grabación». */
export function sessionRowView(d: OverviewDate, recording: DateRecording | null | undefined): string {
  const { attended, base } = baseCounts(d);
  const parts = [base === 0 ? "Sin base" : `${attended} de ${base}`];
  const clicks = unconfirmedClicks(d);
  if (clicks > 0) parts.push(clicks === 1 ? "1 clic sin confirmar" : `${clicks} clics sin confirmar`);
  parts.push(hasRecording(recording) ? "Con grabación" : "Sin grabación");
  return parts.join(" · ");
}

/** % de asistencia sobre varias fechas: suma asistentes de la base / suma de las bases. `null` = «—». */
export function attendanceRate(dates: OverviewDate[]): number | null {
  let a = 0;
  let b = 0;
  for (const d of dates) {
    const c = baseCounts(d);
    a += c.attended;
    b += c.base;
  }
  return b === 0 ? null : Math.round((a / b) * 100);
}

/** % de un estudiante: solo cuentan las fechas en las que estaba en la base. `null` = «—». */
export function studentRate(dates: OverviewDate[], contactId: string): number | null {
  const mine = dates.filter((d) => d.base.includes(contactId));
  if (!mine.length) return null;
  const went = mine.filter((d) => d.attended.some((a) => a.contact_id === contactId)).length;
  return Math.round((went / mine.length) * 100);
}

export const pctLabel = (n: number | null): string => (n === null ? "—" : `${n} %`);

export interface CalendarKpis {
  rate: number | null;
  withoutRecording: number;
  unconfirmedClicks: number;
  next: { live_session_id: string; starts_at: string } | null;
}

export function calendarKpis(past: OverviewDate[], recordings: Map<string, DateRecording>, upcoming: Array<{ live_session_id: string; starts_at: string; status: string }>): CalendarKpis {
  const next = upcoming.filter((u) => u.status !== "cancelled").sort((x, y) => x.starts_at.localeCompare(y.starts_at))[0] ?? null;
  return {
    rate: attendanceRate(past),
    withoutRecording: past.filter((d) => !hasRecording(recordings.get(dateKey(d.live_session_id, d.occurs_on)))).length,
    unconfirmedClicks: past.reduce((n, d) => n + unconfirmedClicks(d), 0),
    next: next ? { live_session_id: next.live_session_id, starts_at: next.starts_at } : null,
  };
}

export const dateKey = (sessionId: string, occursOn: string) => `${sessionId}|${occursOn}`;

/** Las semanas (lunes a domingo) de un mes, con los días de afuera para completar. `month` es 1-12. */
export function monthGrid(year: number, month: number): Array<Array<{ date: string; inMonth: boolean }>> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const first = new Date(Date.UTC(year, month - 1, 1));
  const dow = first.getUTCDay() === 0 ? 7 : first.getUTCDay();
  const start = new Date(first.getTime() - (dow - 1) * 86_400_000);
  const last = new Date(Date.UTC(year, month, 0));
  const weeks: Array<Array<{ date: string; inMonth: boolean }>> = [];
  let cur = start;
  while (cur <= last || weeks.length === 0 || weeks[weeks.length - 1].length < 7) {
    if (!weeks.length || weeks[weeks.length - 1].length === 7) {
      if (cur > last) break;
      weeks.push([]);
    }
    const d = `${cur.getUTCFullYear()}-${pad(cur.getUTCMonth() + 1)}-${pad(cur.getUTCDate())}`;
    weeks[weeks.length - 1].push({ date: d, inMonth: cur.getUTCMonth() === month - 1 });
    cur = new Date(cur.getTime() + 86_400_000);
  }
  return weeks;
}

/** El mes anterior o siguiente («2026-11» → «2026-12»). */
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Lo que muestra la tarjeta de una serie: el promedio de sus últimas 6 fechas y la barrita de cada una. */
export function seriesStats(sessionId: string, past: OverviewDate[]): { rate: number | null; bars: Array<{ occursOn: string; pct: number | null }> } {
  const mine = past.filter((d) => d.live_session_id === sessionId).sort((a, b) => a.occurs_on.localeCompare(b.occurs_on)).slice(-6);
  return {
    rate: attendanceRate(mine),
    bars: mine.map((d) => {
      const c = baseCounts(d);
      return { occursOn: d.occurs_on, pct: c.base === 0 ? null : Math.round((c.attended / c.base) * 100) };
    }),
  };
}

/** «Se mide sobre: …» de una sesión. */
export function baseLabel(base: { type: string; days?: number; phase_key?: string; variant_id?: string }, names: { phase?: string | null; variant?: string | null } = {}): string {
  switch (base.type) {
    case "started_within":
      return `Quienes empezaron hace ${base.days} días o menos`;
    case "phase":
      return `Quienes están en la fase «${names.phase ?? "elegida"}»`;
    case "variant":
      return `Quienes compraron «${names.variant ?? "la variante elegida"}»`;
    default:
      return "Todos con acceso al calendario";
  }
}
