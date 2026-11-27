"use client";
// @plantilla-quitar(servicios)

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, ListChecks, MoreHorizontal, Plus, Video, X } from "lucide-react";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { SidePanel } from "@/components/tasks/overlay";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { PortalMenu, PortalMenuItem, PortalMenuSeparator } from "@/components/ui/portal-menu";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { fieldInput } from "@/components/content/dialog";
import { TaskWorkbench, useTaskWorkbench } from "@/components/tasks/task-workbench";
import { TaskLine } from "@/components/tasks/task-line";
import { cn } from "@/lib/utils";
import {
  listClassTasks,
  loadSessionSheet,
  markAttendance,
  removeAttendance,
  saveClassNote,
  saveLiveDate,
  searchStudentsForAttendance,
  suggestRecordings,
  type SessionSheet,
} from "@/lib/actions/live-sessions";
import { attendanceCell, baseCounts, hasRecording, type DateRecording, type OverviewDate } from "@/lib/program/calendar-view";
import { classSections } from "@/lib/program/class-drawer";
import { splitOpenDone } from "@/lib/tasks/contact-tasks";
import type { ContactTasksPayload } from "@/lib/tasks/contact-section";
import type { TaskRow } from "@/lib/tasks/types";
import type { CalendarData, CalendarSession } from "@/lib/program/load-calendar";

/** Una fecha de una sesión: próxima o pasada. `occurs_on` es la fecha ORIGINAL (la clave), aunque se haya movido. */
export interface ClassOccurrence {
  live_session_id: string;
  occurs_on: string;
  starts_at: string;
  ends_at: string;
  status: "normal" | "cancelled" | "moved";
}

type Recording = (DateRecording & { recording_source: string | null }) | null;

/**
 * El drawer de UNA clase (una fecha de una sesión en vivo), igual para las próximas y las pasadas: arriba qué y cuándo,
 * con «Entrar» y el menú «⋯» (mover, cancelar, quién la ve, editar la sesión); después las notas internas y las tareas
 * de la clase; y en una que ya pasó, la grabación y la asistencia. La configuración de toda la serie NO vive acá:
 * «Editar sesión» abre el formulario de siempre. Qué se muestra lo decide `classSections` (lib/program/class-drawer).
 */
export function ClassDrawer(props: {
  productId: string;
  session: CalendarSession;
  occurrence: ClassOccurrence;
  /** La asistencia de la fecha (solo si ya pasó y está en las cargadas). */
  past: OverviewDate | null;
  recording: Recording;
  note: string | null;
  data: CalendarData;
  baseText: string;
  canManage: boolean;
  canAttendance: boolean;
  canSeeTasks: boolean;
  onClose: () => void;
  onEditSession: () => void;
  /** Las notas quedaron guardadas (para que reabrir la clase las muestre sin pedir la página de nuevo). */
  onNoteSaved: (html: string) => void;
}) {
  const { session, occurrence } = props;
  const [tasks, setTasks] = useState<{ status: "loading" | "ready" | "error" | "hidden"; data: ContactTasksPayload | null }>({ status: props.canSeeTasks ? "loading" : "hidden", data: null });

  const fetchTasks = useCallback(() => {
    if (!props.canSeeTasks) return;
    void listClassTasks(session.id, occurrence.occurs_on).then((r) => {
      if (r.ok) setTasks({ status: "ready", data: r.data });
      else setTasks({ status: r.code === "forbidden" ? "hidden" : "error", data: null });
    });
  }, [props.canSeeTasks, session.id, occurrence.occurs_on]);
  useEffect(() => fetchTasks(), [fetchTasks]);
  const retryTasks = useCallback(() => {
    setTasks((t) => ({ ...t, status: "loading" }));
    fetchTasks();
  }, [fetchTasks]);

  const d = tasks.data;
  // El anfitrión de tareas envuelve el panel: el drawer de una tarea queda AL LADO (encima), no adentro.
  return (
    <TaskWorkbench
      initialTasks={d?.tasks ?? EMPTY_TASKS}
      members={d?.members ?? []}
      currentUserId={d?.currentUserId ?? ""}
      today={d?.today ?? ""}
      timeZone={d?.timeZone ?? "UTC"}
      timeFormat={d?.timeFormat}
      canEdit={d?.canEdit ?? false}
      canDelete={d?.canDelete ?? false}
    >
      <ClassPanel {...props} tasksStatus={tasks.status} onRetryTasks={retryTasks} />
    </TaskWorkbench>
  );
}

const EMPTY_TASKS: TaskRow[] = [];

function ClassPanel({
  productId,
  session,
  occurrence,
  past,
  recording,
  note,
  data,
  baseText,
  canManage,
  canAttendance,
  onClose,
  onEditSession,
  onNoteSaved,
  tasksStatus,
  onRetryTasks,
}: Parameters<typeof ClassDrawer>[0] & { tasksStatus: "loading" | "ready" | "error" | "hidden"; onRetryTasks: () => void }) {
  const router = useRouter();
  const tz = useViewerTimezone();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"move" | "audience" | null>(null);
  // «Ahora», fijo mientras el drawer está abierto (una clase no cambia de próxima a pasada en la mitad).
  const [now] = useState(() => Date.now());
  const started = Date.parse(occurrence.starts_at) <= now;
  const show = classSections({ started, status: occurrence.status, canManage, canSeeTasks: tasksStatus !== "hidden" });
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es", { timeZone: tz, ...o }).format(new Date(iso));
  const dayRaw = fmt(occurrence.starts_at, { weekday: "long", day: "numeric", month: "long" });
  const day = dayRaw.charAt(0).toUpperCase() + dayRaw.slice(1);
  const hours = `${fmt(occurrence.starts_at, { hour: "2-digit", minute: "2-digit" })} – ${fmt(occurrence.ends_at, { hour: "2-digit", minute: "2-digit" })}`;
  const host = data.team.find((t) => t.id === session.host_user_id) ?? null;
  const key = `${session.id}|${occurrence.occurs_on}`;
  const outside = session.variant_ids?.length ? data.variants.filter((x) => !session.variant_ids!.includes(x.id)) : [];

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error?.message ?? "No se pudo guardar");
      after?.();
      router.refresh();
    });

  return (
    <SidePanel
      label={`${session.title} del ${day}`}
      onClose={onClose}
      header={
        <div className="flex w-full items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-snug">{session.title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {day} · {hours}
            </p>
            {occurrence.status !== "normal" && (
              <span className={cn("mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium", occurrence.status === "cancelled" ? "bg-destructive/10 text-destructive" : "bg-accent")}>
                {occurrence.status === "cancelled" ? "Cancelada" : "Movida"}
              </span>
            )}
          </div>
          {show.enter && session.meeting_url && (
            <a href={session.meeting_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Video className="h-3.5 w-3.5" aria-hidden /> Entrar
            </a>
          )}
          {show.menu && (
            <PortalMenu label="Más acciones de esta clase" align="end" width={240} trigger={<MoreHorizontal className="h-4 w-4" aria-hidden />} triggerClassName="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
              <PortalMenuItem onSelect={() => setPanel("move")}>Mover esta fecha</PortalMenuItem>
              {occurrence.status === "normal" ? (
                <PortalMenuItem
                  className="text-destructive"
                  onSelect={() => confirm("¿Cancelar esta fecha? Desaparece del portal; las demás fechas de la serie siguen igual.") && run(() => saveLiveDate(productId, session.id, occurrence.occurs_on, { status: "cancelled" }))}
                >
                  Cancelar esta fecha
                </PortalMenuItem>
              ) : (
                <PortalMenuItem onSelect={() => run(() => saveLiveDate(productId, session.id, occurrence.occurs_on, { status: "normal" }))}>Volver a la fecha original</PortalMenuItem>
              )}
              {outside.length > 0 && <PortalMenuItem onSelect={() => setPanel("audience")}>Quién ve esta fecha</PortalMenuItem>}
              <PortalMenuSeparator />
              <PortalMenuItem onSelect={onEditSession}>{session.kind === "weekly" ? "Editar la sesión (toda la serie)" : "Editar la sesión"}</PortalMenuItem>
            </PortalMenu>
          )}
          <button type="button" onClick={onClose} aria-label="Cerrar" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      }
    >
      <div className="space-y-6 p-4">
        {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Anfitrión</dt>
            <dd className="mt-1">{host ? <PersonAvatar userId={host.id} name={host.name} role="Anfitrión" showName /> : <span className="text-muted-foreground">Sin anfitrión</span>}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">La asistencia se mide sobre</dt>
            <dd className="mt-1">{baseText}</dd>
          </div>
        </dl>

        {panel === "move" && (
          <MoveBox
            pending={pending}
            timezone={session.timezone}
            onCancel={() => setPanel(null)}
            onMove={(local) => run(() => saveLiveDate(productId, session.id, occurrence.occurs_on, { status: "moved", movedToLocal: local }), () => setPanel(null))}
          />
        )}
        {panel === "audience" && (
          <AudienceBox
            pending={pending}
            options={outside}
            initial={data.extras?.[key] ?? []}
            onCancel={() => setPanel(null)}
            onSave={(ids) => run(() => saveLiveDate(productId, session.id, occurrence.occurs_on, { extraVariantIds: ids }), () => setPanel(null))}
          />
        )}

        {show.recording && <RecordingSection productId={productId} session={session} occurrence={occurrence} recording={recording} canManage={canManage} />}

        <Section title="Notas internas" hint="Solo las ve el equipo: nunca llegan al portal.">
          <NotesEditor productId={productId} sessionId={session.id} occursOn={occurrence.occurs_on} initial={note ?? ""} editable={show.notes === "edit"} onSaved={onNoteSaved} />
        </Section>

        {show.tasks && (
          <Section title="Tareas">
            <ClassTasks sessionId={session.id} occursOn={occurrence.occurs_on} status={tasksStatus} onRetry={onRetryTasks} />
          </Section>
        )}

        {show.attendance && <AttendanceSection productId={productId} session={session} occurrence={occurrence} past={past} canAttendance={canAttendance} />}
      </div>
    </SidePanel>
  );
}

function Section({ title, hint, right, children }: { title: string; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </section>
  );
}

function MoveBox({ pending, timezone, onCancel, onMove }: { pending: boolean; timezone: string; onCancel: () => void; onMove: (local: string) => void }) {
  const [moveTo, setMoveTo] = useState("");
  return (
    <section className="space-y-2 rounded-lg border border-border bg-muted/30 p-3" aria-label="Mover esta fecha">
      <p className="text-sm font-medium">Mover esta fecha</p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="datetime-local" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={cn(fieldInput, "w-auto")} aria-label="Fecha y hora nuevas" />
        <button type="button" disabled={pending || !moveTo} onClick={() => onMove(moveTo)} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
          Mover
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm hover:bg-accent">Cancelar</button>
      </div>
      <p className="text-[11px] text-muted-foreground">En la zona de la sesión ({timezone}). La asistencia queda en la fecha original.</p>
    </section>
  );
}

function AudienceBox({ pending, options, initial, onCancel, onSave }: { pending: boolean; options: Array<{ id: string; name: string }>; initial: string[]; onCancel: () => void; onSave: (ids: string[]) => void }) {
  const [extra, setExtra] = useState<string[]>(initial);
  return (
    <section className="space-y-2 rounded-lg border border-border bg-muted/30 p-3" aria-label="Quién ve esta fecha">
      <p className="text-sm font-medium">También la ven (solo esta fecha)</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map((x) => (
          <label key={x.id} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={extra.includes(x.id)} disabled={pending} onChange={(e) => setExtra(e.target.checked ? [...extra, x.id] : extra.filter((id) => id !== x.id))} />
            {x.name}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={pending || [...extra].sort().join() === [...initial].sort().join()} onClick={() => onSave(extra)} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
          Guardar
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm hover:bg-accent">Cancelar</button>
      </div>
    </section>
  );
}

// ── Notas ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Se guardan solas (800 ms después de dejar de escribir, y al cerrar si quedó algo). Gana el último que guarda. */
function NotesEditor({ productId, sessionId, occursOn, initial, editable, onSaved }: { productId: string; sessionId: string; occursOn: string; initial: string; editable: boolean; onSaved: (html: string) => void }) {
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saved = useRef(initial);
  const pendingValue = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pendingValue.current;
    if (next === null || next === saved.current) return;
    pendingValue.current = null;
    setState("saving");
    void saveClassNote(productId, sessionId, occursOn, next).then((r) => {
      if (r.ok) {
        saved.current = next;
        onSavedRef.current(next);
        setState("saved");
      } else setState("error");
    });
  }, [productId, sessionId, occursOn]);

  // Al cerrar el drawer, lo que quedó sin guardar se guarda igual.
  useEffect(() => () => flush(), [flush]);

  if (!editable) {
    return initial ? (
      <RichTextEditor id={`class-note-${sessionId}-${occursOn}`} label="Notas internas" value={initial} onChange={() => {}} disabled emoji={false} minHeight={60} />
    ) : (
      <p className="text-sm text-muted-foreground">Sin notas.</p>
    );
  }

  return (
    <div className="space-y-1">
      <RichTextEditor
        id={`class-note-${sessionId}-${occursOn}`}
        label="Notas internas"
        value={value}
        minHeight={120}
        onChange={(html) => {
          setValue(html);
          pendingValue.current = html;
          setState("idle");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, 800);
        }}
      />
      <p className={cn("h-4 text-[11px]", state === "error" ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
        {state === "saving" ? "Guardando…" : state === "saved" ? "Guardado" : state === "error" ? "No se pudo guardar. Escribí de nuevo para reintentar." : ""}
      </p>
    </div>
  );
}

// ── Tareas ───────────────────────────────────────────────────────────────────────────────────────────────────────

function ClassTasks({ sessionId, occursOn, status, onRetry }: { sessionId: string; occursOn: string; status: "loading" | "ready" | "error" | "hidden"; onRetry: () => void }) {
  const wb = useTaskWorkbench();
  if (status === "loading") {
    return (
      <div aria-busy="true" aria-label="Cargando tareas" className="space-y-2">
        <div className="h-9 animate-pulse rounded-lg bg-muted/50" />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        <span className="flex-1">No pude cargar las tareas de esta clase.</span>
        <button type="button" onClick={onRetry} className="h-7 rounded-md border border-destructive/40 px-2 text-xs hover:bg-destructive/10">Reintentar</button>
      </div>
    );
  }
  const mine = wb.tasks.filter((t) => t.live_session_id === sessionId && t.live_session_on === occursOn && !t.deleted_at);
  const { open, done } = splitOpenDone(mine, wb.zones);
  const names = new Map(wb.members.map((m) => [m.id, m.name]));
  const line = (t: TaskRow) => <TaskLine key={t.id} task={t} wb={wb} ownerName={t.owner_id ? (names.get(t.owner_id) ?? null) : null} />;
  return (
    <div className="space-y-2">
      {open.length === 0 && done.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ListChecks className="h-4 w-4 shrink-0" aria-hidden /> Esta clase no tiene tareas.
        </p>
      )}
      {open.length > 0 && <ul className="divide-y divide-border rounded-lg border border-border">{open.map(line)}</ul>}
      {done.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Completadas ({done.length})</summary>
          <ul className="mt-1 divide-y divide-border rounded-lg border border-border">{done.slice(0, 10).map(line)}</ul>
        </details>
      )}
      {wb.canEdit && (
        <button
          type="button"
          onClick={() => wb.startCreate({ live_session_id: sessionId, live_session_on: occursOn })}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 text-sm text-muted-foreground hover:border-primary-edge hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar tarea
        </button>
      )}
    </div>
  );
}

// ── Grabación ────────────────────────────────────────────────────────────────────────────────────────────────────

function RecordingSection({ productId, session, occurrence, recording, canManage }: { productId: string; session: CalendarSession; occurrence: ClassOccurrence; recording: Recording; canManage: boolean }) {
  const router = useRouter();
  const tz = useViewerTimezone();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const has = hasRecording(recording);
  const [editing, setEditing] = useState(!has);
  const [link, setLink] = useState(recording?.recording_url ?? "");
  const [suggest, setSuggest] = useState<Array<{ id: string; title: string; recorded_at: string }> | null>(null);
  const hhmm = (iso: string) => new Intl.DateTimeFormat("es", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  const act = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error?.message ?? "No se pudo guardar");
      setEditing(false);
      setSuggest(null);
      router.refresh();
    });

  return (
    <Section
      title="Grabación"
      right={has && canManage && !editing ? <button type="button" onClick={() => setEditing(true)} className="text-xs text-primary-ink hover:underline">Cambiar</button> : undefined}
    >
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {has && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
          <Video className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1">{recording?.recording_call_id ? "Grabación de Fathom" : "Grabación con link"}</span>
          {recording?.recording_call_id && (
            <Link href={`/dashboard/llamadas/${recording.recording_call_id}`} className="inline-flex items-center gap-1 text-primary-ink hover:underline">
              Abrir en Grabaciones
            </Link>
          )}
          {recording?.recording_url && (
            <a href={recording.recording_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-ink hover:underline">
              Ver video <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
        </div>
      )}
      {!has && !canManage && <p className="text-sm text-muted-foreground">Todavía no tiene grabación.</p>}
      {canManage && editing && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link de Drive, YouTube, Vimeo o Loom" className={cn(fieldInput, "min-w-0 flex-1")} aria-label="Link de la grabación" />
            <button type="button" disabled={pending} onClick={() => act(() => saveLiveDate(productId, session.id, occurrence.occurs_on, { recordingUrl: link, recordingCallId: recording?.recording_call_id ?? null }))} className="rounded-md border border-border px-2 py-1 text-sm hover:bg-accent">
              Guardar link
            </button>
          </div>
          <button type="button" disabled={pending} onClick={() => void suggestRecordings(occurrence.starts_at).then((r) => setSuggest(r.ok ? r.data : []))} className="text-sm text-primary-ink hover:underline">
            Buscar la grabación de Fathom de ese día
          </button>
          {suggest &&
            (suggest.length === 0 ? (
              <p className="text-xs text-muted-foreground">No hay grabaciones de Fathom de ese día y hora.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                {suggest.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="flex-1">{s.title} · {hhmm(s.recorded_at)}</span>
                    <button type="button" disabled={pending} onClick={() => act(() => saveLiveDate(productId, session.id, occurrence.occurs_on, { recordingCallId: s.id, recordingUrl: link || null }))} className="text-xs text-primary-ink hover:underline">
                      Vincular
                    </button>
                  </li>
                ))}
              </ul>
            ))}
          {has && <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:underline">Listo</button>}
        </div>
      )}
      {canManage && has && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={recording?.recording_active ?? true} disabled={pending} onChange={(e) => act(() => saveLiveDate(productId, session.id, occurrence.occurs_on, { recordingActive: e.target.checked }))} />
          Se ve en el portal
        </label>
      )}
    </Section>
  );
}

// ── Asistencia ───────────────────────────────────────────────────────────────────────────────────────────────────

function AttendanceSection({ productId, session, occurrence, past, canAttendance }: { productId: string; session: CalendarSession; occurrence: ClassOccurrence; past: OverviewDate | null; canAttendance: boolean }) {
  const router = useRouter();
  const tz = useViewerTimezone();
  const [pending, start] = useTransition();
  const [sheet, setSheet] = useState<SessionSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Array<{ contactId: string; name: string; email: string | null; inBase: boolean }>>([]);
  const hhmm = (iso: string) => new Intl.DateTimeFormat("es", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  const reload = useCallback(
    () =>
      loadSessionSheet(session.id, occurrence.occurs_on).then((r) => {
        if (r.ok) setSheet(r.data);
        else setError(r.error.message);
      }),
    [session.id, occurrence.occurs_on],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      void searchStudentsForAttendance(session.id, occurrence.occurs_on, q).then((r) => r.ok && setFound(r.data));
    }, 250);
    return () => clearTimeout(t);
  }, [q, session.id, occurrence.occurs_on]);

  const act = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error?.message ?? "No se pudo hacer");
      await reload();
      router.refresh();
    });

  const base: OverviewDate = past ?? { ...occurrence, base: [], attended: [], clicks: [] };
  const current: OverviewDate = sheet ? { ...base, base: sheet.base, attended: sheet.attended, clicks: sheet.clicks } : base;
  const rows = [...new Set([...current.base, ...current.attended.map((a) => a.contact_id)])];
  const name = (id: string) => sheet?.contacts[id]?.name ?? "…";
  const counts = baseCounts(current);

  return (
    <Section title="Asistencia" right={sheet && counts.base > 0 ? <span className="text-xs text-muted-foreground">{counts.attended} de {counts.base}</span> : undefined}>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {!sheet ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nadie tenía acceso a esta fecha.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {rows.map((c) => {
            const cell = attendanceCell(current, c, hhmm);
            const a = current.attended.find((x) => x.contact_id === c);
            return (
              <li key={c} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <span className="flex-1">{name(c)}</span>
                {a?.added_manually && <span className="rounded bg-accent px-1.5 text-xs">Agregado a mano</span>}
                {cell.state === "no_access" && !a && <span className="text-xs text-muted-foreground">Sin acceso ese día</span>}
                <span className={cn("text-xs", cell.state === "absent" && "text-muted-foreground", cell.state === "clicked" && "text-warn")}>{cell.state === "no_access" ? "" : cell.label}</span>
                {canAttendance && !a && (
                  <button type="button" disabled={pending} onClick={() => act(() => markAttendance(productId, session.id, occurrence.occurs_on, c))} className="text-xs text-primary-ink hover:underline">
                    Marcar asistió
                  </button>
                )}
                {canAttendance && a && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      const reason = prompt("¿Por qué se quita la asistencia?");
                      if (reason && reason.trim()) act(() => removeAttendance(productId, a.id, reason));
                    }}
                    className="text-xs text-destructive hover:underline"
                  >
                    Quitar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canAttendance && (
        <div className="space-y-1">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Agregar a alguien que asistió (nombre o email)" className={fieldInput} aria-label="Agregar un estudiante que asistió" />
          {q.trim().length >= 2 && (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {found.length === 0 && <li className="px-3 py-1.5 text-xs text-muted-foreground">Sin resultados</li>}
              {found.map((f) => (
                <li key={f.contactId}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setQ("");
                      setFound([]);
                      act(() => markAttendance(productId, session.id, occurrence.occurs_on, f.contactId));
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
                  >
                    <span className="flex-1">
                      {f.name}
                      {f.email ? <span className="text-xs text-muted-foreground"> · {f.email}</span> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">{f.inBase ? "Cuenta para el promedio" : "Fuera de la base"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}
