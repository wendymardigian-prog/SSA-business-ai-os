// @plantilla-quitar(servicios)
import type { PermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc, svcSchema } from "@/lib/services/db";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import type { DateRecording, OverviewDate } from "@/lib/program/calendar-view";
import type { AttendanceBase } from "@/lib/program/occurrences";

export interface CalendarSession {
  id: string;
  title: string;
  kind: "weekly" | "single";
  weekdays: number[] | null;
  every_weeks: number | null;
  starts_on: string | null;
  ends_on: string | null;
  single_at: string | null;
  start_time: string | null;
  duration_minutes: number;
  timezone: string;
  variant_ids: string[] | null;
  host_user_id: string | null;
  keyword: string | null;
  track_clicks: boolean;
  click_counts_as_attendance: boolean;
  attendance_base: AttendanceBase;
  archived_at: string | null;
  /** El link de la reunión: solo para el equipo (lo lee el servidor; nunca viaja al portal). */
  meeting_url: string | null;
}

export interface CalendarOccurrence {
  live_session_id: string;
  occurs_on: string;
  starts_at: string;
  ends_at: string;
  status: "normal" | "cancelled" | "moved";
}

export interface CalendarData {
  sessions: CalendarSession[];
  upcoming: CalendarOccurrence[];
  /** Las del mes que se mira (para la vista Mes), pasadas y próximas. */
  month: CalendarOccurrence[];
  past: OverviewDate[];
  recordings: Record<string, DateRecording & { recording_source: string | null }>;
  /** R7 (00402): las variantes que ven una fecha además de las de su sesión, por `<sesión>|<fecha>`. */
  extras: Record<string, string[]>;
  /** Las notas internas de cada fecha (HTML limpio), por `<sesión>|<fecha>`. Nunca viajan al portal. */
  notes: Record<string, string>;
  /** Cuántas tareas abiertas tiene cada clase (las que la persona ve), por `<sesión>|<fecha>`. */
  openTasks: Record<string, number>;
  /**
   * La clase pedida por la URL (`?sesion=&fecha=`) cuando no está en las listas cargadas (más vieja que 90 días, más
   * lejana que 60, o de otro mes): su fecha y, si ya pasó, su asistencia.
   */
  focus: { occurrence: CalendarOccurrence | null; past: OverviewDate | null } | null;
  contacts: Record<string, string>;
  variants: Array<{ id: string; name: string }>;
  phases: Array<{ key: string; name: string }>;
  team: Array<{ id: string; name: string }>;
}

const SESSION_COLS = "id, title, kind, weekdays, every_weeks, starts_on, ends_on, single_at, start_time, duration_minutes, timezone, variant_ids, host_user_id, keyword, track_clicks, click_counts_as_attendance, attendance_base, archived_at";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Todo lo que necesita el Calendario de un programa, en paralelo. Sesiones, fechas, asistencia y grabaciones se leen
 * con la sesión (sus RLS); el link de la reunión y los nombres del equipo, con el cliente de servicio, filtrados por el
 * negocio de la sesión, después del permiso de la página.
 */
export async function loadCalendar(
  ctx: Pick<PermissionContext, "supabase" | "workspace">,
  productId: string,
  monthYm: string,
  variants: Array<{ id: string; name: string }>,
  focusRef: { sessionId: string; occursOn: string } | null = null,
): Promise<CalendarData> {
  const today = new Date();
  const [y, m] = monthYm.split("-").map(Number);
  const monthFrom = iso(new Date(Date.UTC(y, m - 1, 1) - 7 * 86_400_000));
  const monthTo = iso(new Date(Date.UTC(y, m, 0) + 7 * 86_400_000));
  const pastFrom = iso(new Date(today.getTime() - 90 * 86_400_000));
  const upTo = iso(new Date(today.getTime() + 60 * 86_400_000));
  const service = await createServiceClient();
  const [{ data: sessions }, { data: links }, upcoming, month, past, { data: phasesRaw }, members] = await Promise.all([
    svcSchema(ctx.supabase).from("live_sessions").select(SESSION_COLS).eq("product_id", productId).eq("workspace_id", ctx.workspace.id).order("created_at"),
    svcSchema(service).from("live_sessions").select("id, meeting_url").eq("product_id", productId).eq("workspace_id", ctx.workspace.id),
    svcRpc<CalendarOccurrence[]>(ctx.supabase, "live_session_occurrences", { p_product_id: productId, p_from: iso(today), p_to: upTo }),
    svcRpc<CalendarOccurrence[]>(ctx.supabase, "live_session_occurrences", { p_product_id: productId, p_from: monthFrom, p_to: monthTo }),
    svcRpc<OverviewDate[]>(ctx.supabase, "live_attendance_overview", { p_product_id: productId, p_from: pastFrom, p_to: iso(today) }),
    ctx.supabase.from("product_variants").select("journey_template" as never).eq("product_id", productId),
    getWorkspaceMembers(ctx.workspace.id),
  ]);
  const meeting = new Map(((links ?? []) as Array<{ id: string; meeting_url: string | null }>).map((l) => [l.id, l.meeting_url]));
  const list = ((sessions ?? []) as unknown as Omit<CalendarSession, "meeting_url">[]).map((s) => ({ ...s, meeting_url: meeting.get(s.id) ?? null }));
  const ids = list.map((s) => s.id);
  const { data: dates } = ids.length
    ? await svcSchema(ctx.supabase).from("live_session_dates").select("live_session_id, occurs_on, recording_url, recording_call_id, recording_source, recording_active, extra_variant_ids, note").in("live_session_id", ids)
    : { data: [] };
  // Las tareas abiertas de cada clase (00537). Si la columna todavía no existe o falla, la lista se ve sin el número.
  const { data: taskRows } = ids.length
    ? await ctx.supabase.from("tasks").select("live_session_id, live_session_on" as never).eq("workspace_id", ctx.workspace.id).in("live_session_id" as never, ids as never).is("deleted_at", null).neq("status", "completed").limit(2000)
    : { data: [] };
  const openTasks: CalendarData["openTasks"] = {};
  for (const t of (taskRows ?? []) as unknown as Array<{ live_session_id: string; live_session_on: string }>) {
    const k = `${t.live_session_id}|${t.live_session_on}`;
    openTasks[k] = (openTasks[k] ?? 0) + 1;
  }
  const recordings: CalendarData["recordings"] = {};
  const extras: CalendarData["extras"] = {};
  const notes: CalendarData["notes"] = {};
  for (const d of (dates ?? []) as Array<{ live_session_id: string; occurs_on: string; recording_url: string | null; recording_call_id: string | null; recording_source: string | null; recording_active: boolean; extra_variant_ids?: string[] | null; note?: string | null }>) {
    if (d.note) notes[`${d.live_session_id}|${d.occurs_on}`] = d.note;
    recordings[`${d.live_session_id}|${d.occurs_on}`] = { recording_url: d.recording_url, recording_call_id: d.recording_call_id, recording_source: d.recording_source, recording_active: d.recording_active };
    if (d.extra_variant_ids?.length) extras[`${d.live_session_id}|${d.occurs_on}`] = d.extra_variant_ids;
  }
  const pastDates = past.ok ? past.data ?? [] : [];
  // La clase de la URL que no quedó en las listas: se pide su día (y su asistencia, si ya pasó).
  let focus: CalendarData["focus"] = null;
  const upcomingList = upcoming.ok ? upcoming.data ?? [] : [];
  const monthList = month.ok ? month.data ?? [] : [];
  const same = (o: { live_session_id: string; occurs_on: string }) => focusRef && o.live_session_id === focusRef.sessionId && o.occurs_on === focusRef.occursOn;
  if (focusRef && ids.includes(focusRef.sessionId) && !pastDates.some(same) && !upcomingList.some(same) && !monthList.some(same)) {
    const [occ, ov] = await Promise.all([
      svcRpc<CalendarOccurrence[]>(ctx.supabase, "live_session_occurrences", { p_product_id: productId, p_from: focusRef.occursOn, p_to: focusRef.occursOn }),
      focusRef.occursOn <= iso(today)
        ? svcRpc<OverviewDate[]>(ctx.supabase, "live_attendance_overview", { p_product_id: productId, p_from: focusRef.occursOn, p_to: focusRef.occursOn })
        : Promise.resolve({ ok: true as const, data: [] as OverviewDate[] }),
    ]);
    focus = {
      occurrence: (occ.ok ? occ.data ?? [] : []).find(same) ?? null,
      past: (ov.ok ? ov.data ?? [] : []).find(same) ?? null,
    };
  }
  const contactIds = [...new Set(pastDates.flatMap((d) => [...d.base, ...d.attended.map((a) => a.contact_id)]))];
  const { data: cs } = contactIds.length ? await ctx.supabase.from("contacts").select("id, display_name, email").in("id", contactIds.slice(0, 1000)) : { data: [] };
  const contacts: Record<string, string> = {};
  for (const c of (cs ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>) contacts[c.id] = c.display_name || c.email || "Sin nombre";
  const phases = new Map<string, string>();
  for (const v of (phasesRaw ?? []) as unknown as Array<{ journey_template: { phases?: Array<{ key: string; name: string }> } | null }>) for (const ph of v.journey_template?.phases ?? []) if (!phases.has(ph.key)) phases.set(ph.key, ph.name);
  const team = members.map((t) => ({ id: t.userId, name: t.name }));
  return {
    sessions: list,
    upcoming: upcomingList,
    month: monthList,
    past: pastDates,
    recordings,
    extras,
    notes,
    openTasks,
    focus,
    contacts,
    variants,
    phases: [...phases].map(([key, name]) => ({ key, name })),
    team,
  };
}
