"use client";
// @plantilla-quitar(servicios)

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListChecks, NotebookPen, Plus } from "lucide-react";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { SidePanel } from "@/components/tasks/overlay";
import { TimezoneSelect } from "@/components/ui/timezone-select";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { cn } from "@/lib/utils";
import { useUrlIntent } from "@/components/ui/use-url-intent";
import { archiveLiveSession, saveLiveSession } from "@/lib/actions/live-sessions";
import { WEEKDAY_LABELS, liveSessionIssues, liveSessionSummary, type LiveSessionInput } from "@/lib/program/live-sessions";
import {
  attendanceCell,
  baseCounts,
  baseLabel,
  calendarKpis,
  dateKey,
  monthGrid,
  pctLabel,
  seriesStats,
  sessionRowView,
  studentRate,
  type OverviewDate,
} from "@/lib/program/calendar-view";
import type { CalendarData, CalendarOccurrence, CalendarSession } from "@/lib/program/load-calendar";
import { Tip } from "@/components/ui/tooltip";
import { Tabs } from "@/components/ui/tabs";
import { ClickableBox } from "@/components/ui/clickable-row";
import { ClassDrawer, type ClassOccurrence } from "@/components/services/portal/class-drawer";
import { withClassRef, withListTab, type ClassRef, type ListTab } from "@/lib/program/class-drawer";

type View = "lista" | "mes" | "series" | "grilla";

/** Un color por serie, con tokens del tema (se leen en claro y en oscuro). */
const COLORS = ["bg-primary/15 text-foreground", "bg-c-agent/15 text-foreground", "bg-c-team/15 text-foreground", "bg-c-auto/15 text-foreground", "bg-c-ext/15 text-foreground"];

/**
 * Portal › programa › Calendario (F58-F63). Las vistas viven en la URL (`?tab=calendario&vista=`); el formulario de una
 * sesión y la ficha de una fecha pasada son paneles laterales. Lo que se calcula sale de `lib/program/calendar-view`.
 */
export function ProgramCalendar({
  productId,
  data,
  view,
  month,
  seriesFilter,
  canManage,
  canAttendance,
  canSeeTasks,
  initialListTab,
  initialClass,
  defaultTimezone,
}: {
  productId: string;
  data: CalendarData;
  view: View;
  month: string;
  seriesFilter: string | null;
  canManage: boolean;
  canAttendance: boolean;
  /** `tasks.view`: la sección «Tareas» del drawer de una clase. */
  canSeeTasks: boolean;
  initialListTab: ListTab;
  /** La clase de la URL (`?sesion=&fecha=`), abierta al entrar. */
  initialClass: ClassRef | null;
  defaultTimezone: string;
}) {
  const tz = useViewerTimezone();
  const [form, setForm] = useState<{ session: CalendarSession | null; date?: string } | null>(null);
  const [openClass, setOpenClass] = useState<ClassRef | null>(initialClass);
  const [listTab, setListTab] = useState<ListTab>(initialListTab);
  // Las notas guardadas desde el drawer (reabrir la clase las muestra sin pedir la página de nuevo).
  const [savedNotes, setSavedNotes] = useState<Record<string, string>>({});
  const active = data.sessions.filter((s) => !s.archived_at);
  const byId = useMemo(() => new Map(data.sessions.map((s) => [s.id, s])), [data.sessions]);
  const color = (id: string) => COLORS[Math.max(0, active.findIndex((s) => s.id === id)) % COLORS.length];
  const recordings = useMemo(() => new Map(Object.entries(data.recordings)), [data.recordings]);
  const kpis = calendarKpis(data.past, recordings, data.upcoming);
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es", { timeZone: tz, ...opts }).format(new Date(iso));
  const when = (iso: string) => fmt(iso, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const hhmm = (iso: string) => fmt(iso, { hour: "2-digit", minute: "2-digit" });
  const href = (v: View, extra: Record<string, string> = {}) => `/dashboard/portal/${productId}?${new URLSearchParams({ tab: "calendario", vista: v, mes: month, ...extra })}`;
  const series = active.filter((s) => s.kind === "weekly");
  const variantName = (id: string | undefined) => data.variants.find((v) => v.id === id)?.name ?? null;
  const phaseName = (k: string | undefined) => data.phases.find((p) => p.key === k)?.name ?? null;
  const baseText = (s: CalendarSession) => {
    const b = s.attendance_base as { type: string; days?: number; phase_key?: string; variant_id?: string };
    return baseLabel(b, { phase: phaseName(b.phase_key), variant: variantName(b.variant_id) });
  };

  // La clase abierta vive en la URL (`?sesion=&fecha=`), sin pedirle la página al servidor.
  const openOccurrence = (o: { live_session_id: string; occurs_on: string }) => {
    if (!byId.get(o.live_session_id)) return;
    const ref = { sessionId: o.live_session_id, occursOn: o.occurs_on };
    setOpenClass(ref);
    window.history.pushState(null, "", `?${withClassRef(window.location.search.slice(1), ref)}`);
  };
  const closeClass = () => {
    setOpenClass(null);
    window.history.replaceState(null, "", `?${withClassRef(window.location.search.slice(1), null)}`);
  };
  const changeTab = (t: ListTab) => {
    setListTab(t);
    window.history.replaceState(null, "", `?${withListTab(window.location.search.slice(1), t)}`);
  };
  const onNoteSaved = useCallback((key: string, html: string) => setSavedNotes((n) => ({ ...n, [key]: html })), []);

  // Dónde está la clase abierta: en las pasadas, las próximas, las del mes o la que se pidió aparte (`data.focus`).
  const findClass = (ref: ClassRef): { occurrence: ClassOccurrence | null; past: OverviewDate | null } => {
    const same = (o: { live_session_id: string; occurs_on: string }) => o.live_session_id === ref.sessionId && o.occurs_on === ref.occursOn;
    const past = data.past.find(same) ?? data.focus?.past ?? null;
    const occurrence = past ?? data.upcoming.find(same) ?? data.month.find(same) ?? data.focus?.occurrence ?? null;
    return { occurrence, past };
  };

  // Lista | Mes | Recurrentes, el mes y «+ Sesión» viven en la barra superior (Servicios A2): «+ Sesión» llega como
  // `?nuevo=sesion`.
  useUrlIntent("nuevo", (v) => {
    if (v === "sesion" && canManage) setForm({ session: null });
  });

  return (
    <div className="space-y-4">
      {data.sessions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Todavía no hay sesiones en vivo. {canManage ? "Sumá la primera con «+ Sesión»." : ""}
        </p>
      ) : view === "lista" ? (
        <ListView />
      ) : view === "mes" ? (
        <MonthView />
      ) : view === "series" ? (
        <SeriesView />
      ) : (
        <GridView />
      )}
      {openClass && byId.get(openClass.sessionId) && (() => {
        const s = byId.get(openClass.sessionId) as CalendarSession;
        const found = findClass(openClass);
        if (!found.occurrence) return null;
        const key = dateKey(openClass.sessionId, openClass.occursOn);
        return (
          <ClassDrawer
            key={key}
            productId={productId}
            session={s}
            occurrence={found.occurrence}
            past={found.past}
            recording={data.recordings[key] ?? null}
            note={savedNotes[key] ?? data.notes[key] ?? null}
            data={data}
            baseText={baseText(s)}
            canManage={canManage}
            canAttendance={canAttendance}
            canSeeTasks={canSeeTasks}
            onClose={closeClass}
            onEditSession={() => setForm({ session: s })}
            onNoteSaved={(html) => onNoteSaved(key, html)}
          />
        );
      })()}
      {form && (
        <SessionDrawer
          productId={productId}
          session={form.session}
          date={form.date}
          data={data}
          defaultTimezone={defaultTimezone}
          canManage={canManage}
          onClose={() => setForm(null)}
        />
      )}
    </div>
  );

  function ListView() {
    // Por fecha y hora: la base las devuelve agrupadas por sesión (todos los lunes, después todos los viernes).
    const upcoming = [...data.upcoming].sort((x, y) => x.starts_at.localeCompare(y.starts_at)).slice(0, 30);
    const past = [...data.past].reverse().slice(0, 40);
    // Lo que lleva una clase, chiquito al final de la fila: notas y tareas abiertas.
    const marks = (sessionId: string, occursOn: string) => {
      const k = dateKey(sessionId, occursOn);
      const hasNote = !!(savedNotes[k] ?? data.notes[k]);
      const tasks = data.openTasks[k] ?? 0;
      return (
        <>
          {hasNote && (
            <Tip content="Tiene notas internas">
              <NotebookPen className="h-3.5 w-3.5 text-muted-foreground" aria-label="Tiene notas internas" />
            </Tip>
          )}
          {tasks > 0 && (
            <Tip content={tasks === 1 ? "1 tarea abierta" : `${tasks} tareas abiertas`}>
              <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground" aria-label={tasks === 1 ? "1 tarea abierta" : `${tasks} tareas abiertas`}>
                <ListChecks className="h-3.5 w-3.5" aria-hidden /> {tasks}
              </span>
            </Tip>
          )}
        </>
      );
    };
    const rowClass = "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm transition-colors hover:bg-accent";
    return (
      <div className="space-y-6">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { k: "Asistencia promedio", v: pctLabel(kpis.rate), link: href("grilla") },
            { k: "Sesiones sin grabación", v: String(kpis.withoutRecording) },
            { k: "Clics sin confirmar", v: String(kpis.unconfirmedClicks) },
            { k: "Próxima sesión", v: kpis.next ? when(kpis.next.starts_at) : "—" },
          ].map((x) => (
            <div key={x.k} className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">{x.k}</dt>
              <dd className="mt-1 text-lg font-semibold">{x.link ? <Link href={x.link} className="hover:underline">{x.v}</Link> : x.v}</dd>
            </div>
          ))}
        </dl>
        <Tabs
          label="Clases"
          value={listTab}
          onChange={changeTab}
          tabs={[
            { value: "proximas", label: `Próximas (${upcoming.length})` },
            { value: "pasadas", label: `Pasadas (${past.length})` },
          ]}
        >
          {listTab === "proximas" ? (
            upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay sesiones en los próximos 60 días.</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {upcoming.map((o) => {
                  const s = byId.get(o.live_session_id);
                  if (!s) return null;
                  return (
                    <li key={dateKey(o.live_session_id, o.occurs_on)}>
                      <ClickableBox onOpen={() => openOccurrence(o)} aria-label={`Abrir ${s.title} del ${when(o.starts_at)}`} className={cn(rowClass, o.status === "cancelled" && "text-muted-foreground")}>
                        <span className={cn("w-40 shrink-0 tabular-nums", o.status === "cancelled" && "line-through")}>{when(o.starts_at)}</span>
                        <span className={cn("font-medium", o.status === "cancelled" && "line-through")}>{s.title}</span>
                        {o.status === "moved" && <span className="rounded bg-accent px-1.5 text-xs">Movida</span>}
                        {o.status === "cancelled" && <span className="rounded bg-destructive/10 px-1.5 text-xs text-destructive">Cancelada</span>}
                        <span className="hidden text-xs text-muted-foreground lg:inline">Se mide sobre: {baseText(s)}</span>
                        <span className="flex-1" />
                        {marks(o.live_session_id, o.occurs_on)}
                        {s.meeting_url && o.status !== "cancelled" && (
                          <a href={s.meeting_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-ink hover:underline">
                            Link de la clase
                          </a>
                        )}
                      </ClickableBox>
                    </li>
                  );
                })}
              </ul>
            )
          ) : past.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no pasó ninguna sesión.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {past.map((d) => {
                const s = byId.get(d.live_session_id);
                if (!s) return null;
                return (
                  <li key={dateKey(d.live_session_id, d.occurs_on)}>
                    <ClickableBox onOpen={() => openOccurrence(d)} aria-label={`Abrir ${s.title} del ${when(d.starts_at)}`} className={rowClass}>
                      <span className="w-40 shrink-0 tabular-nums">{when(d.starts_at)}</span>
                      <span className="font-medium">{s.title}</span>
                      <span className="flex-1" />
                      {marks(d.live_session_id, d.occurs_on)}
                      <span className="text-xs text-muted-foreground">{sessionRowView(d, recordings.get(dateKey(d.live_session_id, d.occurs_on)))}</span>
                    </ClickableBox>
                  </li>
                );
              })}
            </ul>
          )}
        </Tabs>
      </div>
    );
  }

  function MonthView() {
    const [y, m] = month.split("-").map(Number);
    const weeks = monthGrid(y, m);
    const today = new Date().toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
    const byDay = new Map<string, CalendarOccurrence[]>();
    for (const o of data.month) {
      const day = fmt(o.starts_at, { year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().join("-");
      byDay.set(day, [...(byDay.get(day) ?? []), o]);
    }
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium capitalize">{label}</h3>
          <span className="flex-1" />
          <ul className="flex flex-wrap gap-2 text-xs" aria-label="Series">
            {active.map((s) => <li key={s.id} className={cn("rounded px-1.5", color(s.id))}>{s.title}</li>)}
          </ul>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] table-fixed border-collapse text-xs">
            <thead>
              <tr>{WEEKDAY_LABELS.map((d) => <th key={d} className="py-1 font-medium capitalize text-muted-foreground">{d.slice(0, 3)}</th>)}</tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w[0].date}>
                  {w.map((d) => (
                    <td key={d.date} className={cn("h-24 border border-border p-1 align-top", !d.inMonth && "bg-muted/40 text-muted-foreground")}>
                      <div className="flex items-center justify-between">
                        <span className={cn(d.date === today && "rounded bg-primary px-1 text-primary-foreground")}>{Number(d.date.slice(8))}</span>
                        {canManage && (
                          <button type="button" aria-label={`Agregar una sesión el ${d.date}`} onClick={() => setForm({ session: null, date: d.date })} className="rounded p-0.5 text-muted-foreground hover:bg-accent">
                            <Plus className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {(byDay.get(d.date) ?? []).map((o) => {
                          const s = byId.get(o.live_session_id);
                          const isPast = Date.parse(o.starts_at) <= Date.now();
                          const noRec = isPast && o.status !== "cancelled" && !recordings.get(dateKey(o.live_session_id, o.occurs_on))?.recording_url && !recordings.get(dateKey(o.live_session_id, o.occurs_on))?.recording_call_id;
                          return (
                            <li key={dateKey(o.live_session_id, o.occurs_on)}>
                              <button type="button" onClick={() => openOccurrence(o)} className={cn("flex w-full items-center gap-1 truncate rounded px-1 text-left", color(o.live_session_id), o.status === "cancelled" && "line-through opacity-60")}>
                                {noRec && <span aria-label="Sin grabación" className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />}
                                {hhmm(o.starts_at)} {s?.title}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function SeriesView() {
    return (
      <div className="space-y-3">
        <Link href={href("lista")} className="text-xs text-muted-foreground hover:underline">← Volver al calendario</Link>
        {series.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay sesiones que se repitan.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {series.map((s) => {
              const st = seriesStats(s.id, data.past);
              const lastBase = [...data.past].reverse().find((d) => d.live_session_id === s.id);
              return (
                <li key={s.id} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-start gap-2">
                    <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", color(s.id).split(" ")[0])} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{s.title}</p>
                      <p className="text-xs text-muted-foreground">{liveSessionSummary(s, when)} · {s.duration_minutes} min</p>
                      <p className="text-xs text-muted-foreground">
                        Anfitrión: {data.team.find((t) => t.id === s.host_user_id)?.name ?? "—"} · Para: {s.variant_ids ? s.variant_ids.map((v) => variantName(v)).filter(Boolean).join(", ") : "todas las variantes"}
                      </p>
                    </div>
                    <span className="text-lg font-semibold">{pctLabel(st.rate)}</span>
                  </div>
                  <div className="flex h-10 items-end gap-1" aria-label="Asistencia de las últimas fechas">
                    {st.bars.map((b) => (
                      <Tip key={b.occursOn} asChild content={`${b.occursOn}: ${pctLabel(b.pct)}`}>
                        <span className="w-4 rounded-t bg-primary/60" style={{ height: `${Math.max(4, b.pct ?? 0)}%` }} />
                      </Tip>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Se mide sobre: {baseText(s)}{lastBase ? ` (${baseCounts(lastBase).base} en la última fecha)` : ""}</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {canManage && <button type="button" onClick={() => setForm({ session: s })} className="rounded-md border border-border px-2 py-1 hover:bg-accent">Editar</button>}
                    <Link href={href("grilla", { serie: s.id })} className="rounded-md border border-border px-2 py-1 hover:bg-accent">Ver asistencia por estudiante</Link>
                    {canManage && <ArchiveButton productId={productId} sessionId={s.id} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  function GridView() {
    const dates = data.past.filter((d) => !seriesFilter || d.live_session_id === seriesFilter);
    const students = [...new Set(dates.flatMap((d) => [...d.base, ...d.attended.map((a) => a.contact_id)]))].sort((a, b) => (data.contacts[a] ?? "").localeCompare(data.contacts[b] ?? ""));
    const title = seriesFilter ? byId.get(seriesFilter)?.title : null;
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={href(seriesFilter ? "series" : "lista")} className="text-xs text-muted-foreground hover:underline">← Volver</Link>
          <h3 className="font-semibold">Asistencia por estudiante{title ? ` · ${title}` : ""}</h3>
          <span className="text-xs text-muted-foreground">Últimos 90 días · el % cuenta solo las fechas con acceso</span>
        </div>
        {dates.length === 0 || students.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay fechas pasadas con estudiantes.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr className="bg-muted/40">
                  <th className="sticky left-0 bg-muted px-2 py-1 text-left font-medium">Estudiante</th>
                  <th className="px-2 py-1 font-medium">%</th>
                  {dates.map((d) => (
                    <th key={dateKey(d.live_session_id, d.occurs_on)} className="whitespace-nowrap px-2 py-1 font-medium">
                      <button type="button" onClick={() => openOccurrence(d)} className="hover:underline">{fmt(d.starts_at, { day: "numeric", month: "short" })}</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((c) => (
                  <tr key={c} className="border-t border-border">
                    <td className="sticky left-0 whitespace-nowrap bg-background px-2 py-1">{data.contacts[c] ?? "Sin nombre"}</td>
                    <td className="px-2 py-1 text-center">{pctLabel(studentRate(dates, c))}</td>
                    {dates.map((d) => {
                      const cell = attendanceCell(d, c, hhmm);
                      return (
                        <td key={dateKey(d.live_session_id, d.occurs_on)} className={cn("whitespace-nowrap px-2 py-1 text-center", cell.state === "absent" && "text-muted-foreground", cell.state === "clicked" && "text-warn")}>
                          {cell.label}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }
}

function ArchiveButton({ productId, sessionId }: { productId: string; sessionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        confirm("¿Archivar esta serie? Deja de dar fechas; su asistencia y sus grabaciones quedan.") &&
        start(async () => {
          const r = await archiveLiveSession(productId, sessionId, true);
          if (!r.ok) alert(r.error.message);
          router.refresh();
        })
      }
      className="rounded-md border border-border px-2 py-1 text-destructive hover:bg-accent"
    >
      Archivar
    </button>
  );
}

function SessionDrawer({
  productId,
  session,
  date,
  data,
  defaultTimezone,
  canManage,
  onClose,
}: {
  productId: string;
  session: CalendarSession | null;
  date?: string;
  data: CalendarData;
  defaultTimezone: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dow = date ? ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1 : null;
  const [v, setV] = useState<LiveSessionInput>(() =>
    session
      ? {
          title: session.title,
          kind: session.kind,
          weekdays: session.weekdays ?? [],
          everyWeeks: session.every_weeks ?? 1,
          startsOn: session.starts_on ?? "",
          endsOn: session.ends_on,
          singleLocal: session.single_at ? new Intl.DateTimeFormat("sv-SE", { timeZone: session.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(session.single_at)).replace(" ", "T") : "",
          startTime: (session.start_time ?? "").slice(0, 5),
          durationMinutes: session.duration_minutes,
          timezone: session.timezone,
          variantIds: session.variant_ids,
          hostUserId: session.host_user_id,
          meetingUrl: session.meeting_url,
          keyword: session.keyword,
          trackClicks: session.track_clicks,
          clickCountsAsAttendance: session.click_counts_as_attendance,
          attendanceBase: session.attendance_base,
        }
      : { title: "", kind: "single", weekdays: dow ? [dow] : [], everyWeeks: 1, startsOn: date ?? "", singleLocal: date ? `${date}T19:00` : "", startTime: "19:00", durationMinutes: 60, timezone: defaultTimezone, variantIds: null, trackClicks: true, clickCountsAsAttendance: false, attendanceBase: { type: "active" } },
  );
  const set = (patch: Partial<LiveSessionInput>) => setV((x) => ({ ...x, ...patch }));
  const issues = liveSessionIssues(v);
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error?.message ?? "No se pudo guardar");
      router.refresh();
      onClose();
    });
  const base = v.attendanceBase ?? { type: "active" };

  return (
    <SidePanel
      label={session ? `Sesión ${session.title}` : "Sesión nueva"}
      onClose={onClose}
      header={<h2 className="text-base font-semibold">{session ? session.title : "Sesión nueva"}</h2>}
      footer={
        canManage && (
          <>
            {error && <p role="alert" className="w-full text-xs text-destructive">{error}</p>}
            <button type="button" disabled={pending || issues.length > 0} onClick={() => run(() => saveLiveSession(productId, session?.id ?? null, v))} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
              {session ? (session.kind === "weekly" ? "Guardar (cambia la serie)" : "Guardar") : "Crear sesión"}
            </button>
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm hover:bg-accent">Cancelar</button>
            {issues.length > 0 && <span className="text-xs text-muted-foreground">{issues[0]}</span>}
          </>
        )
      }
    >
      <div className="space-y-4 p-4">
        <DialogField label="Nombre">
          <input value={v.title} onChange={(e) => set({ title: e.target.value })} className={fieldInput} maxLength={120} />
        </DialogField>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">Cuándo</legend>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-1"><input type="radio" checked={v.kind === "single"} onChange={() => set({ kind: "single" })} /> Una vez</label>
            <label className="flex items-center gap-1"><input type="radio" checked={v.kind === "weekly"} onChange={() => set({ kind: "weekly" })} /> Se repite</label>
          </div>
          {v.kind === "single" ? (
            <input type="datetime-local" value={v.singleLocal ?? ""} onChange={(e) => set({ singleLocal: e.target.value })} className={fieldInput} aria-label="Fecha y hora" />
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1" role="group" aria-label="Días">
                {WEEKDAY_LABELS.map((d, i) => {
                  const on = (v.weekdays ?? []).includes(i + 1);
                  return (
                    <button key={d} type="button" aria-pressed={on} onClick={() => set({ weekdays: on ? (v.weekdays ?? []).filter((x) => x !== i + 1) : [...(v.weekdays ?? []), i + 1] })} className={cn("rounded-md border px-2 py-1 text-xs capitalize", on ? "border-primary-edge bg-primary/10" : "border-border")}>
                      {d.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <DialogField label="Cada">
                  <select value={v.everyWeeks} onChange={(e) => set({ everyWeeks: Number(e.target.value) })} className={fieldInput}>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 1 ? "semana" : `${n} semanas`}</option>)}
                  </select>
                </DialogField>
                <DialogField label="Hora">
                  <input type="time" value={v.startTime ?? ""} onChange={(e) => set({ startTime: e.target.value })} className={fieldInput} />
                </DialogField>
                <DialogField label="Desde">
                  <input type="date" value={v.startsOn ?? ""} onChange={(e) => set({ startsOn: e.target.value })} className={fieldInput} />
                </DialogField>
                <DialogField label="Hasta (opcional)">
                  <input type="date" value={v.endsOn ?? ""} onChange={(e) => set({ endsOn: e.target.value || null })} className={fieldInput} />
                </DialogField>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <DialogField label="Duración (minutos)">
              <input type="number" min={5} max={720} value={v.durationMinutes} onChange={(e) => set({ durationMinutes: Number(e.target.value) })} className={fieldInput} />
            </DialogField>
            <DialogField label="Zona horaria">
              <TimezoneSelect value={v.timezone} onChange={(timezone) => set({ timezone })} className={fieldInput} />
            </DialogField>
          </div>
        </fieldset>
        <DialogField label="Link de la reunión" hint="Lo ve solo el equipo: el estudiante entra con el botón «Entrar» del portal.">
          <input type="url" value={v.meetingUrl ?? ""} onChange={(e) => set({ meetingUrl: e.target.value })} className={fieldInput} placeholder="https://" />
        </DialogField>
        <DialogField label="Anfitrión">
          <select value={v.hostUserId ?? ""} onChange={(e) => set({ hostUserId: e.target.value || null })} className={fieldInput}>
            <option value="">Sin anfitrión</option>
            {data.team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </DialogField>
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium">Para</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={!v.variantIds} onChange={() => set({ variantIds: null })} /> Todas las variantes</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={!!v.variantIds} onChange={() => set({ variantIds: [] })} /> Solo estas</label>
          {v.variantIds && (
            <div className="ml-5 space-y-1">
              {data.variants.map((x) => (
                <label key={x.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={v.variantIds!.includes(x.id)} onChange={(e) => set({ variantIds: e.target.checked ? [...v.variantIds!, x.id] : v.variantIds!.filter((y) => y !== x.id) })} />
                  {x.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <DialogField label="Sobre quiénes se mide la asistencia" hint="Quien asiste fuera de esta lista queda registrado, pero no suma ni resta al promedio.">
          <select
            value={base.type}
            onChange={(e) => {
              const t = e.target.value;
              const next: LiveSessionInput["attendanceBase"] =
                t === "started_within" ? { type: "started_within", days: 30 } : t === "phase" ? { type: "phase", phase_key: data.phases[0]?.key ?? "" } : t === "variant" ? { type: "variant", variant_id: data.variants[0]?.id ?? "" } : { type: "active" };
              set({ attendanceBase: next });
            }}
            className={fieldInput}
          >
            <option value="active">Todos con acceso al calendario</option>
            <option value="started_within">Quienes empezaron hace N días o menos</option>
            {data.phases.length > 0 && <option value="phase">Quienes están en una fase del camino</option>}
            <option value="variant">Quienes compraron una variante</option>
          </select>
        </DialogField>
        {base.type === "started_within" && (
          <input type="number" min={1} max={365} value={base.days} onChange={(e) => set({ attendanceBase: { type: "started_within", days: Number(e.target.value) } })} className={fieldInput} aria-label="Días" />
        )}
        {base.type === "phase" && (
          <select value={base.phase_key} onChange={(e) => set({ attendanceBase: { type: "phase", phase_key: e.target.value } })} className={fieldInput} aria-label="Fase">
            {data.phases.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        )}
        {base.type === "variant" && (
          <select value={base.variant_id} onChange={(e) => set({ attendanceBase: { type: "variant", variant_id: e.target.value } })} className={fieldInput} aria-label="Variante">
            {data.variants.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.trackClicks ?? true} onChange={(e) => set({ trackClicks: e.target.checked })} /> Registrar los clics al link de la clase</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.clickCountsAsAttendance ?? false} onChange={(e) => set({ clickCountsAsAttendance: e.target.checked })} /> Contar el clic como asistencia</label>
        <DialogField label="Palabra clave (opcional)">
          <input value={v.keyword ?? ""} onChange={(e) => set({ keyword: e.target.value })} className={fieldInput} maxLength={60} />
        </DialogField>
      </div>
    </SidePanel>
  );
}
