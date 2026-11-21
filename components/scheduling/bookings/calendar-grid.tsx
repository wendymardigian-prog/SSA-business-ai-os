"use client";

/**
 * El calendario de agendas (F35): día, semana y mes.
 *
 * La colocación la hace `placeInCalendar` (núcleo): acá solo se dibuja. Las
 * canceladas no se muestran, como en el prototipo.
 *
 * En el celular la semana no entra: pasa a una agenda por día, que es lo que
 * hace la vista de contenido de la Etapa 2.
 */

import { useEffect, useMemo, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BookingListItem } from "@/lib/scheduling/data/bookings";
import { placeInCalendar, type CalendarView } from "@/lib/scheduling/calendar-view";
import { rangeFor, shiftAnchor } from "@/lib/scheduling/calendar-range";
import { capitalize, formatSlotLabel } from "@/lib/scheduling/booker/format";
import { groupOf } from "@/lib/scheduling/booking-status";
import { bookingDropToStartUtc, dragCreateRange, durationLabel, isSameStart, resizeDuration, type BookingDrop } from "@/lib/scheduling/booking-drag";
import { dateInTz, minutesOfDayInTz, wallClockToUtc } from "@/lib/scheduling/time/tz";
import { busyBlocksForDay, TEAM_STATUS_TEXT, type TeamBusyStatus } from "@/lib/scheduling/team-view";
import { useToast } from "@/components/content/drawer/toast";
import { useOptionalTaskWorkbench } from "@/components/tasks/task-workbench"; // @plantilla-quitar(tareas)
import { placeTasksInCalendar } from "@/lib/tasks/calendar"; // @plantilla-quitar(tareas)
import { dropTarget, isSameDrop, movedMessage, undoPatch, type TaskDropTarget } from "@/lib/tasks/calendar-drag"; // @plantilla-quitar(tareas)
import { snapMinutes } from "@/lib/calendar/snap";
import { isDraggableTask, tasksModeParam, type TasksMode } from "@/lib/tasks/calendar-ui"; // @plantilla-quitar(tareas)
import { layoutOverlaps, type Span } from "@/lib/calendar/layoutOverlaps";
import type { TaskRow } from "@/lib/tasks/types"; // @plantilla-quitar(tareas)
import { TaskCard, TaskMonthChip, UndatedPanel, taskDayEntry, taskHoverContent } from "./calendar-tasks"; // @plantilla-quitar(tareas)
import { Avatar } from "@/components/ui/filter-menu";
import { colorOf, initialsOf } from "@/lib/shared/people";
import { StatusChip, statusDotClass } from "./status-chip";
import { placeGoogleInCalendar, canEditGoogleEvent, type AgendaGoogleBusy, type AgendaGoogleEvent } from "@/lib/google-calendar/agenda";
import { GoogleCard, GoogleChip, GoogleRefresh } from "./google-layer";
import { DayAgendaModal } from "./day-agenda-modal";
import { daySummary, type DayEntry } from "@/lib/calendar/day-agenda";
import { statusLabel } from "@/lib/scheduling/booking-status";
import { useCalendarHover } from "./calendar-hover-card";
import { bookingHover, busyHover, googleHover } from "@/lib/calendar/hover-content";
import { clampStyle, linesThatFit } from "@/lib/calendar/card-lines";
import { useIsDesktop } from "./use-desktop";

const VIEWS: Array<{ key: CalendarView; label: string }> = [
  { key: "day", label: "Día" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mes" },
];

/** La franja que se dibuja: de 7 a 21, como el prototipo. */
const FIRST_HOUR = 7;
const LAST_HOUR = 21;
const HOUR_PX = 44;

function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return capitalize(new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d))));
}

/** Lo que se arrastra ahora mismo. */
type Dragging = { kind: "task"; id: string } | { kind: "booking"; id: string } | { kind: "google"; id: string };

/** 00510: la capa «Google» del calendario. Sin esto, el calendario es el de siempre. */
export interface GoogleLayerControls {
  on: boolean;
  onToggle: (on: boolean) => void;
  events: AgendaGoogleEvent[];
  busy: AgendaGoogleBusy[];
  refreshing: boolean;
  onRefresh: () => void;
  note: string | null;
  onOpen: (id: string) => void;
  /** Se soltó un evento propio en otro horario: SIEMPRE abre una confirmación. */
  onDrop?: (event: AgendaGoogleEvent, startUtc: string) => void;
  /** Se estiró o encogió un evento propio: también con confirmación. */
  onResize?: (event: AgendaGoogleEvent, durationMinutes: number) => void;
}

/** El fantasma de la agenda que se esta reagendando (mientras el modal de confirmacion esta abierto). */
export interface BookingGhost {
  bookingId: string;
  startUtc: string;
  durationMinutes: number;
  label: string;
}

/**
 * El borde para estirar: el cursor de «agrandar o achicar» y una barrita que aparece al pasar el mouse por la tarjeta
 * (es la hermana anterior: `peer`) o por el borde, y con el foco de teclado.
 */
const RESIZE_HANDLE_CLASS =
  "absolute z-[5] cursor-ns-resize rounded-b-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring peer-hover:[&>span]:opacity-100 hover:[&>span]:opacity-100 focus-visible:[&>span]:opacity-100";
const RESIZE_GRIP_CLASS =
  "pointer-events-none absolute left-1/2 top-1/2 h-1 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/50 opacity-0 transition-opacity";

/** Alto minimo de una tarjeta, en pixeles: lo que ocupa aunque dure poco. */
const MIN_CARD_PX = 26;
/** Desde este alto la tarjeta tiene lugar para el estado como chip; mas baja, solo un punto de color. */
const CHIP_CARD_PX = 40;

/** El circulo de quien atiende la reunion: su foto o, si no tiene, sus iniciales. Decorativo: el nombre va en el tooltip. */
function HostAvatar({ item, hostNames }: { item: BookingListItem; hostNames: Record<string, string> }) {
  const name = hostNames[item.hostUserId] ?? item.hostName ?? "";
  return (
    <span title={name ? `Anfitrión: ${name}` : "Sin anfitrión"} className="shrink-0">
      <Avatar initials={initialsOf(name)} color={colorOf(item.hostUserId)} size="sm" userId={item.hostUserId} />
    </span>
  );
}

export function BookingsCalendar({
  items,
  hostNames = {},
  timezone,
  timeFormat,
  view,
  anchor,
  onView,
  onAnchor,
  onOpen,
  taskControls, // @plantilla-quitar(tareas)
  canDragBookings = false,
  onDropBooking,
  ghost = null,
  onCreateRange,
  onResizeBooking,
  google,
  showMenu,
  includeCancelled = false,
  team,
  teamControls,
}: {
  items: BookingListItem[];
  /** Nombre de cada anfitrión por su id, para el círculo de la tarjeta. */
  hostNames?: Record<string, string>;
  timezone: string;
  timeFormat: "12h" | "24h";
  view: CalendarView;
  /** Fecha `YYYY-MM-DD` del día (o del día dentro de la semana o el mes). */
  anchor: string;
  onView: (view: CalendarView) => void;
  onAnchor: (date: string) => void;
  onOpen: (id: string) => void;
  // @plantilla-desde(tareas)
  /**
   * Tareas × CRM (R7): el interruptor «Tareas». Sin esto (o con el modo apagado) el calendario es el de siempre y no
   * consulta ni dibuja nada de tareas.
   */
  taskControls?: { mode: TasksMode; onMode: (mode: TasksMode) => void };
  // @plantilla-hasta(tareas)
  /** R8: las agendas activas se pueden arrastrar (solo escritorio). */
  canDragBookings?: boolean;
  /** R8: se solto una agenda en otro horario o dia. SIEMPRE abre una confirmacion: nada se guarda aca. */
  onDropBooking?: (item: BookingListItem, drop: BookingDrop, startUtc: string) => void;
  ghost?: BookingGhost | null;
  /** se arrastró sobre un hueco vacío de la rejilla (solo escritorio). Abre «Agendar» con ese horario. */
  onCreateRange?: (date: string, startMinutes: number, durationMinutes: number, hostUserId?: string | null) => void;
  /** se estiró o encogió una reunión desde su borde de abajo. SIEMPRE pide confirmación. */
  onResizeBooking?: (item: BookingListItem, durationMinutes: number) => void;
  /** 00510: los eventos de Google Calendar. */
  google?: GoogleLayerControls;
  /** «Qué mostrar»: el desplegable de reuniones (estados), tareas y Google. */
  showMenu?: ReactNode;
  /** Se eligió algún estado cancelado en «Qué mostrar»: se dibujan. */
  includeCancelled?: boolean;
  /**
   * La vista de equipo (solo en «Día», para quien ve las agendas de todos): una columna por persona con sus reuniones
   * y su ocupado real de Google (solo horarios). `selfId` es quien mira: su columna lleva sus eventos con detalle.
   */
  team?: { selfId: string; people: Array<{ userId: string; name: string; status: TeamBusyStatus; busy: Array<{ startAt: string; endAt: string }> }> };
  /** El interruptor «Por persona / Todo junto» (solo en «Día» y con permiso). */
  teamControls?: { on: boolean; onToggle: (on: boolean) => void };
}) {
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const wb = useOptionalTaskWorkbench(); // @plantilla-quitar(tareas)
  const toast = useToast();
  const isDesktop = useIsDesktop();
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const tasksOn = !!taskControls && taskControls.mode !== "off" && !!wb; // @plantilla-quitar(tareas)

  const placement = useMemo(
    () =>
      placeInCalendar(
        items.map((i) => ({ ...i, status: i.status, start_at: i.startAt, end_at: i.endAt, event_color: i.eventColor })),
        timezone,
        view,
        { range, includeCancelled },
      ),
    [items, range, timezone, view, includeCancelled],
  );

  // Hoy (en la zona de quien mira) y la hora actual: se actualizan solos cada minuto.
  const now = useNow();
  const today = dateInTz(now, timezone);
  const nowMinutes = minutesOfDayInTz(now, timezone);
  const [dayOpen, setDayOpen] = useState<string | null>(null);

  const days = Object.keys(placement.byDate).sort();

  // Las columnas de la rejilla: un día cada una o, en la vista de equipo, una persona cada una (el mismo día).
  const teamMode = view === "day" && !!team && team.people.length > 0;
  const gridColumns: Array<{ key: string; date: string; userId: string | null }> = teamMode
    ? team!.people.map((p) => ({ key: `u:${p.userId}`, date: days[0], userId: p.userId }))
    : days.map((d) => ({ key: d, date: d, userId: null }));
  const isSelfColumn = (userId: string | null) => !userId || userId === team?.selfId;
  const personOf = (userId: string | null) => (userId ? team?.people.find((p) => p.userId === userId) : undefined);
  // El ocupado real de una persona en la vista de equipo (minutos desde la medianoche de quien mira). En la propia
  // columna solo si la capa de Google está apagada: prendida, ya se ven los eventos con su detalle.
  const teamBusyIn = (date: string, userId: string | null) => {
    const person = personOf(userId);
    if (!teamMode || !person || person.busy.length === 0) return [];
    if (userId === team?.selfId && google?.on) return [];
    return busyBlocksForDay(person.busy, wallClockToUtc(date, "00:00", timezone).toISOString(), wallClockToUtc(date, "24:00", timezone).toISOString());
  };
  const bookingsIn = (date: string, userId: string | null) =>
    (placement.byDate[date] ?? []).filter((it) => !userId || (it.booking as unknown as BookingListItem).hostUserId === userId);

  // @plantilla-desde(tareas)
  // Las tareas (solo con el interruptor encendido).
  const taskPlacement = useMemo(
    () => (tasksOn && wb ? placeTasksInCalendar({ tasks: wb.tasks, workspaceTz: wb.timeZone, viewerTz: timezone, view, range }) : null),
    [tasksOn, wb, timezone, view, range],
  );
  const canEditTasks = !!wb?.canEdit;
  const taskDraggable = (task: TaskRow) => isDesktop && !!wb && isDraggableTask(task, canEditTasks);
  // @plantilla-hasta(tareas)
  const bookingDraggable = (item: BookingListItem) => isDesktop && canDragBookings && !!onDropBooking && groupOf(item.status) === "active";

  // 00510: los eventos de Google (solo con el interruptor prendido).
  const googleOn = !!google?.on;
  const googlePlacement = useMemo(
    () => (google && google.on ? placeGoogleInCalendar({ events: google.events, busy: google.busy, viewerTz: timezone, view, range }) : null),
    [google, timezone, view, range],
  );
  const googleEventsById = useMemo(() => new Map((google?.events ?? []).map((e) => [e.id, e])), [google]);
  const googleDraggable = (ev: AgendaGoogleEvent) => isDesktop && googleOn && !!google?.onDrop && canEditGoogleEvent(ev) && !ev.allDay;
  const googleResizable = (ev: AgendaGoogleEvent) => googleDraggable(ev) && !!google?.onResize;
  const hasAllDay = !!googlePlacement && Object.values(googlePlacement.byDate).some((list) => list.some((i) => !i.timed));

  // El reparto lado a lado de lo que se superpone (solo con tareas o Google: sin ellas, el dibujo no cambia).
  const columnsByDate = useMemo(() => {
    const out = new Map<string, Map<string, { column: number; columns: number }>>();
    const layered = !!googlePlacement || !!taskPlacement; // @plantilla-quitar(tareas)
    // @plantilla-sin(tareas): const layered = !!googlePlacement;
    if (!layered) return out;
    const minMinutes = Math.ceil((MIN_CARD_PX / HOUR_PX) * 60);
    // Las mismas columnas que la rejilla (días, o personas en la vista de equipo), armadas acá adentro para el memo.
    const memoDays = Object.keys(placement.byDate).sort();
    const memoTeam = view === "day" && team && team.people.length > 0 ? team : null;
    const cols = memoTeam
      ? memoTeam.people.map((p) => ({ key: `u:${p.userId}`, date: memoDays[0], userId: p.userId as string | null }))
      : memoDays.map((d) => ({ key: d, date: d, userId: null as string | null }));
    const self = (userId: string | null) => !userId || userId === memoTeam?.selfId;
    for (const { key: colKey, date, userId: colUser } of cols) {
      const spans: Span[] = (placement.byDate[date] ?? [])
        .filter((it) => !colUser || (it.booking as unknown as BookingListItem).hostUserId === colUser)
        .map((it) => ({ id: `b:${(it.booking as unknown as BookingListItem).id}`, start: it.startMinutes, end: it.endMinutes }));
      // @plantilla-desde(tareas)
      if (taskPlacement && self(colUser)) {
        spans.push(...(taskPlacement.byDate[date] ?? []).filter((i) => i.timed).map((i) => ({ id: `t:${i.task.id}`, start: i.startMinutes as number, end: i.endMinutes as number })));
      }
      // @plantilla-hasta(tareas)
      if (googlePlacement && self(colUser)) {
        for (const g of googlePlacement.byDate[date] ?? []) if (g.timed) spans.push({ id: g.key, start: g.startMinutes, end: g.endMinutes });
      }
      out.set(colKey, new Map(layoutOverlaps(spans, minMinutes).map((p) => [p.id, { column: p.column, columns: p.columns }])));
    }
    return out;
  }, [
    taskPlacement, // @plantilla-quitar(tareas)
    googlePlacement,
    placement,
    team,
    view,
  ]);

  // ── Arrastre ──────────────────────────────────────────────────────────────
  // @plantilla-desde(tareas)
  function startTask(task: TaskRow, e: DragEvent<HTMLElement>) {
    e.dataTransfer.setData("text/plain", task.id);
    e.dataTransfer.effectAllowed = "move";
    setDragging({ kind: "task", id: task.id });
  }
  // @plantilla-hasta(tareas)
  function startBooking(item: BookingListItem, e: DragEvent<HTMLElement>) {
    e.dataTransfer.setData("text/plain", item.id);
    e.dataTransfer.effectAllowed = "move";
    setDragging({ kind: "booking", id: item.id });
  }
  function startGoogle(id: string, e: DragEvent<HTMLElement>) {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setDragging({ kind: "google", id });
  }
  const endDrag = () => setDragging(null);

  // ── crear arrastrando y cambiar la duración (punteros, no arrastre nativo) ──────────────────────────────
  const [selecting, setSelecting] = useState<{ date: string; from: number; to: number; userId: string | null } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; start: number; to: number; original: number } | null>(null);
  // La tarjeta al pasar el mouse: al instante, nunca mientras se arrastra, se crea o se estira.
  const hover = useCalendarHover(!!dragging || !!selecting || !!resizing);
  const hoverBooking = (item: BookingListItem) => hover.bind(bookingHover(item, hostNames[item.hostUserId] ?? item.hostName ?? null, timezone, timeFormat));
  const hoverGoogle = (gi: import("@/lib/google-calendar/agenda").GooglePlaced) =>
    hover.bind(gi.kind === "event" ? googleHover(gi.event, timezone, timeFormat) : busyHover(gi.busy, hostNames[gi.busy.userId], timezone, timeFormat));
  const minutesAt = (e: PointerEvent<HTMLElement>, column: HTMLElement) =>
    snapMinutes(e.clientY - column.getBoundingClientRect().top, HOUR_PX, FIRST_HOUR);
  const canCreate = isDesktop && !!onCreateRange;
  const canResize = (item: BookingListItem) => bookingDraggable(item) && !!onResizeBooking;

  function selectStart(date: string, e: PointerEvent<HTMLElement>, userId: string | null = null) {
    if (!canCreate || e.button !== 0 || dragging) return;
    // Solo sobre el fondo de la columna: una tarjeta o su borde tienen lo suyo.
    if ((e.target as HTMLElement).closest("button,[data-cal-handle]")) return;
    const at = minutesAt(e, e.currentTarget);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setSelecting({ date, from: at, to: at, userId });
  }
  function selectMove(e: PointerEvent<HTMLElement>) {
    if (!selecting) return;
    const at = minutesAt(e, e.currentTarget);
    if (at !== selecting.to) setSelecting({ ...selecting, to: at });
  }
  function selectEnd() {
    if (!selecting || !onCreateRange) return setSelecting(null);
    const range = dragCreateRange(selecting.from, selecting.to);
    setSelecting(null);
    onCreateRange(selecting.date, range.startMinutes, range.durationMinutes, selecting.userId);
  }

  function resizeStart(item: BookingListItem, start: number, end: number, e: PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setResizing({ id: item.id, start, to: end, original: end - start });
  }
  function resizeMove(e: PointerEvent<HTMLElement>) {
    if (!resizing) return;
    // La columna del día (el borde está dentro de un envoltorio `display: contents`, que no tiene posición propia:
    // medir contra él corría la hora de fin varias horas).
    const column = e.currentTarget.closest<HTMLElement>("[data-cal-column]");
    if (!column) return;
    const at = minutesAt(e, column);
    if (at !== resizing.to) setResizing({ ...resizing, to: at });
  }
  function resizeEnd(item: BookingListItem) {
    const r = resizing;
    setResizing(null);
    if (!r || r.id !== item.id || !onResizeBooking) return;
    const next = resizeDuration(r.start, r.to);
    if (next !== r.original) onResizeBooking(item, next);
  }
  /** Con el teclado: flecha abajo o arriba suma o resta 15 minutos (también con confirmación). */
  function resizeKey(item: BookingListItem, start: number, end: number, e: KeyboardEvent<HTMLElement>) {
    if (!onResizeBooking || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const next = resizeDuration(start, end + (e.key === "ArrowDown" ? 15 : -15));
    if (next !== end - start) onResizeBooking(item, next);
  }

  // 00510: estirar un evento de Google (mismo gesto que una reunión; el id va con `g:` para no confundirlos).
  function googleResizeStart(ev: AgendaGoogleEvent, start: number, end: number, e: PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setResizing({ id: `g:${ev.id}`, start, to: end, original: end - start });
  }
  function googleResizeEnd(ev: AgendaGoogleEvent) {
    const r = resizing;
    setResizing(null);
    if (!r || r.id !== `g:${ev.id}` || !google?.onResize) return;
    const next = resizeDuration(r.start, r.to);
    if (next !== r.original) google.onResize(ev, next);
  }
  function googleResizeKey(ev: AgendaGoogleEvent, start: number, end: number, e: KeyboardEvent<HTMLElement>) {
    if (!google?.onResize || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const next = resizeDuration(start, end + (e.key === "ArrowDown" ? 15 : -15));
    if (next !== end - start) google.onResize(ev, next);
  }

  /** Un evento de Google soltado: SIEMPRE se pide confirmación (lo hace quien recibe `onDrop`). */
  function dropGoogle(id: string, drop: BookingDrop) {
    const ev = googleEventsById.get(id);
    if (!ev || !googleDraggable(ev) || !google?.onDrop) return;
    const startUtc = bookingDropToStartUtc(drop, timezone, ev.startAt);
    if (isSameStart(startUtc, ev.startAt)) return;
    google.onDrop(ev, startUtc);
  }

  // @plantilla-desde(tareas)
  /** Una tarea soltada: se mueve al instante, sin confirmar, y se puede deshacer. */
  function dropTask(taskId: string, target: TaskDropTarget) {
    if (!wb) return;
    const task = wb.tasks.find((t) => t.id === taskId);
    if (!task || !isDraggableTask(task, canEditTasks)) return;
    const patch = dropTarget({ task, target, workspaceTz: wb.timeZone, viewerTz: timezone });
    if (isSameDrop(task, patch)) return; // soltar en el mismo lugar no hace nada
    const before = { due_date: task.due_date, due_time: task.due_time, duration_minutes: task.duration_minutes };
    void wb.actions.edit(task.id, patch).then((saved) => {
      if (!saved) return; // la accion ya mostro el motivo y devolvio la tarea a su lugar
      toast.push({
        tone: "ok",
        text: movedMessage(patch, timeFormat, wb.today, { workspaceTz: wb.timeZone, viewerTz: timezone }),
        action: { label: "Deshacer", onClick: () => void wb.actions.edit(task.id, undoPatch(before)) },
      });
    });
  }
  // @plantilla-hasta(tareas)

  /** Una agenda soltada: SIEMPRE se pide confirmacion; aca solo se calcula el destino. */
  function dropBooking(bookingId: string, drop: BookingDrop) {
    const item = items.find((i) => i.id === bookingId);
    if (!item || !bookingDraggable(item) || !onDropBooking) return;
    const startUtc = bookingDropToStartUtc(drop, timezone, item.startAt);
    if (isSameStart(startUtc, item.startAt)) return;
    onDropBooking(item, drop, startUtc);
  }

  function handleDrop(target: { kind: "slot"; date: string; minutes: number } | { kind: "allday"; date: string } | { kind: "day"; date: string }) {
    const current = dragging;
    setDragging(null);
    if (!current) return;
    if (current.kind === "google") {
      if (target.kind !== "allday") dropGoogle(current.id, target);
      return;
    }
    if (current.kind === "task") dropTask(current.id, target); // @plantilla-quitar(tareas)
    else if (target.kind !== "allday") dropBooking(current.id, target); // @plantilla-quitar(tareas)
    // @plantilla-sin(tareas): if (target.kind !== "allday") dropBooking(current.id, target);
  }

  /** ¿Este destino acepta lo que se esta arrastrando? (La franja «Sin hora» solo acepta tareas.) */
  const accepts = (kind: "slot" | "allday" | "day") => !!dragging && (dragging.kind === "task" || kind !== "allday");
  const busyOwner = (userId: string) => hostNames[userId];
  const overProps = (kind: "slot" | "allday" | "day") => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (accepts(kind)) e.preventDefault();
    },
  });
  const columnDrop = (date: string) => ({
    ...overProps("slot"),
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!accepts("slot")) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      handleDrop({ kind: "slot", date, minutes: snapMinutes(e.clientY - rect.top, HOUR_PX, FIRST_HOUR) });
    },
  });
  const stripDrop = (date: string) => ({
    ...overProps("allday"),
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!accepts("allday")) return;
      e.preventDefault();
      handleDrop({ kind: "allday", date });
    },
  });
  const cellDrop = (date: string) => ({
    ...overProps("day"),
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!accepts("day")) return;
      e.preventDefault();
      handleDrop({ kind: "day", date });
    },
  });

  const openTask = (id: string) => wb?.openTask(id); // @plantilla-quitar(tareas)
  const ownerOf = (id: string | null) => (id ? (wb?.members.find((m) => m.id === id)?.name ?? null) : null); // @plantilla-quitar(tareas)
  const ghostDate = ghost ? dateInTz(ghost.startUtc, timezone) : null;
  const tasksAvailable = !!taskPlacement; // @plantilla-quitar(tareas)
  // @plantilla-sin(tareas): const tasksAvailable = false;
  const openTaskById = (id: string) => openTask(id); // @plantilla-quitar(tareas)
  // @plantilla-sin(tareas): const openTaskById = (id: string) => void id;

  /** Todo lo de un día para «Ver todo» (reuniones, tareas y eventos de Google), ya armado para la lista. */
  function dayEntries(date: string): DayEntry[] {
    const out: DayEntry[] = [];
    for (const it of placement.byDate[date] ?? []) {
      const item = it.booking as unknown as BookingListItem;
      out.push({
        kind: "booking",
        id: item.id,
        title: item.contactName || item.bookerName || "Sin nombre",
        startMinutes: it.startMinutes,
        timeLabel: `${formatSlotLabel(item.startAt, timezone, timeFormat)} a ${formatSlotLabel(item.endAt, timezone, timeFormat)}`,
        sub: [statusLabel(item.status), item.title].filter(Boolean).join(" · "),
        openable: true,
      });
    }
    for (const gi of googlePlacement?.byDate[date] ?? []) {
      const ev = gi.kind === "event" ? gi.event : null;
      const startAt = ev ? ev.startAt : gi.kind === "busy" ? gi.busy.startAt : "";
      const endAt = ev ? ev.endAt : gi.kind === "busy" ? gi.busy.endAt : "";
      out.push({
        kind: gi.kind === "event" ? "google" : "busy",
        id: ev ? ev.id : gi.key,
        title: gi.kind === "event" ? gi.event.summary?.trim() || "(Sin título)" : `Ocupado${busyOwner(gi.busy.userId) ? ` · ${busyOwner(gi.busy.userId)}` : ""}`,
        startMinutes: gi.timed ? gi.startMinutes : null,
        timeLabel: gi.timed ? `${formatSlotLabel(startAt, timezone, timeFormat)} a ${formatSlotLabel(endAt, timezone, timeFormat)}` : "Todo el día",
        sub: ev ? `Google Calendar · ${ev.calendarName}` : "Google Calendar",
        openable: gi.kind === "event",
      });
    }
    // @plantilla-desde(tareas)
    for (const ti of taskPlacement?.byDate[date] ?? []) out.push(taskDayEntry(ti, timeFormat));
    // @plantilla-hasta(tareas)
    return out;
  }
  const ghostMinutes = ghost ? minutesOfDayInTz(ghost.startUtc, timezone) : 0;

  const content = (
    view === "month" ? (
      <div className="grid grid-cols-7 gap-px bg-border p-px">
        {days.map((date) => (
          <div key={date} className={date === today ? "min-h-24 bg-card bg-[linear-gradient(color-mix(in_srgb,var(--primary)_8%,transparent),color-mix(in_srgb,var(--primary)_8%,transparent))] p-1.5" : "min-h-24 bg-card p-1.5"} {...cellDrop(date)}>
            <button
              type="button"
              onClick={() => setDayOpen(date)}
              {...hover.bind({ title: "Ver todo", lines: [daySummary(dayEntries(date))] })}
              className={date === today ? "mb-1 rounded px-1 text-xs font-semibold text-primary-ink hover:bg-muted" : "mb-1 rounded px-1 text-xs text-muted-foreground hover:bg-muted"}
            >
              {dayLabel(date)}
            </button>
            <div className="flex flex-col gap-1">
              {(placement.byDate[date] ?? []).map((it) => {
                const item = it.booking as unknown as BookingListItem;
                const canDrag = bookingDraggable(item);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpen(item.id)}
                    draggable={canDrag || undefined}
                    onDragStart={canDrag ? (e) => startBooking(item, e) : undefined}
                    onDragEnd={canDrag ? endDrag : undefined}
                    style={{ borderLeftColor: it.eventColor ?? "var(--primary)" }}
                    {...hoverBooking(item)}
                    className={`flex w-full items-center gap-1 rounded border-l-2 bg-muted/60 px-1.5 py-0.5 text-left text-[11px] hover:bg-muted${item.slotReleasedAt ? " border-dashed opacity-60" : ""}`}
                  >
                    <HostAvatar item={item} hostNames={hostNames} />
                    <span className="min-w-0 flex-1 truncate">
                      {formatSlotLabel(item.startAt, timezone, timeFormat)} {item.contactName || item.bookerName || ""}
                    </span>
                    <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(item.status)}`} />
                  </button>
                );
              })}
              {/* @plantilla-desde(tareas) */}
              {taskPlacement &&
                (taskPlacement.byDate[date] ?? []).map((ti) => (
                  <TaskMonthChip key={ti.task.id} item={ti} timeFormat={timeFormat} draggable={taskDraggable(ti.task)} onOpen={openTask} onDragStart={startTask} onDragEnd={endDrag} hover={hover.bind(taskHoverContent(ti, ownerOf(ti.task.owner_id), timeFormat))} />
                ))}
              {/* @plantilla-hasta(tareas) */}
              {googlePlacement &&
                (googlePlacement.byDate[date] ?? []).map((gi) => (
                  <GoogleChip key={gi.key} item={gi} timezone={timezone} timeFormat={timeFormat} ownerName={gi.kind === "busy" ? busyOwner(gi.busy.userId) : undefined} onOpen={google!.onOpen} hover={hoverGoogle(gi)} />
                ))}
              {ghost && ghostDate === date && view === "month" && (
                <span className="truncate rounded border border-dashed border-primary-edge bg-primary/10 px-1.5 py-0.5 text-[11px]">{ghost.label}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <>
        {/* Escritorio: rejilla por hora */}
        <div className="hidden overflow-x-auto md:block">
          <div className="grid" style={{ gridTemplateColumns: `56px repeat(${gridColumns.length}, minmax(${teamMode ? 160 : 0}px, 1fr))`, minWidth: teamMode ? 56 + gridColumns.length * 160 : 640 }}>
            <div />
            {gridColumns.map(({ key: colKey, date, userId: colUser }) => {
              const person = personOf(colUser);
              if (person) {
                const note = person.status === "ok" ? null : TEAM_STATUS_TEXT[person.status];
                return (
                  <div key={colKey} className="border-b border-border p-1.5">
                    <div className="flex items-center justify-center gap-1.5">
                      <Avatar initials={initialsOf(person.name)} color={colorOf(person.userId)} size="sm" userId={person.userId} />
                      <span className="truncate text-xs font-medium">{person.name}</span>
                    </div>
                    {note && <p className="mt-0.5 text-center text-[10px] leading-tight text-amber-700 dark:text-amber-300">{note}</p>}
                  </div>
                );
              }
              return (
              <div key={colKey} className={date === today ? "border-b border-border bg-primary/[0.08] p-1" : "border-b border-border p-1"}>
                <button
                  type="button"
                  onClick={() => setDayOpen(date)}
                  {...hover.bind({ title: "Ver todo", lines: [daySummary(dayEntries(date))] })}
                  className={date === today ? "w-full rounded-md p-1 text-center text-xs font-semibold text-primary-ink hover:bg-muted" : "w-full rounded-md p-1 text-center text-xs font-medium hover:bg-muted"}
                >
                  {dayLabel(date)}
                </button>
              </div>
              );
            })}
            {/* @plantilla-desde(tareas) */}
            {taskPlacement && (
              <>
                <div className="border-b border-border pr-2 pt-1.5 text-right text-[11px] text-muted-foreground">Sin hora</div>
                {gridColumns.map(({ key: colKey, date, userId: colUser }) => (
                  <div key={colKey} aria-label={`Tareas sin hora, ${dayLabel(date)}`} className="flex min-h-9 flex-col gap-1 border-b border-l border-border p-1" {...stripDrop(date)}>
                    {(isSelfColumn(colUser) ? (taskPlacement.byDate[date] ?? []) : [])
                      .filter((ti) => !ti.timed)
                      .map((ti) => (
                        <TaskCard key={ti.task.id} item={ti} timeFormat={timeFormat} draggable={taskDraggable(ti.task)} onOpen={openTask} onDragStart={startTask} onDragEnd={endDrag} compact />
                      ))}
                  </div>
                ))}
              </>
            )}
            {/* @plantilla-hasta(tareas) */}
            {hasAllDay && googlePlacement && (
              <>
                <div className="border-b border-border pr-2 pt-1.5 text-right text-[11px] text-muted-foreground">Todo el día</div>
                {gridColumns.map(({ key: colKey, date, userId: colUser }) => (
                  <div key={colKey} aria-label={`Todo el día, ${dayLabel(date)}`} className="flex min-h-7 flex-col gap-1 border-b border-l border-border p-1">
                    {(isSelfColumn(colUser) ? (googlePlacement.byDate[date] ?? []) : [])
                      .filter((gi) => !gi.timed)
                      .map((gi) => (
                        <GoogleChip key={gi.key} item={gi} timezone={timezone} timeFormat={timeFormat} ownerName={gi.kind === "busy" ? busyOwner(gi.busy.userId) : undefined} onOpen={google!.onOpen} hover={hoverGoogle(gi)} />
                      ))}
                  </div>
                ))}
              </>
            )}
            <div>
              {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => (
                <div key={i} className="border-t border-border pr-2 text-right text-[11px] text-muted-foreground" style={{ height: HOUR_PX }}>
                  {String(FIRST_HOUR + i).padStart(2, "0")}:00
                </div>
              ))}
            </div>
            {gridColumns.map(({ key: colKey, date, userId: colUser }) => (
              <div
                key={colKey}
                data-cal-column
                className={`${canCreate ? "relative cursor-cell select-none border-l border-border" : "relative border-l border-border"}${date === today ? " bg-primary/[0.08]" : ""}`}
                {...columnDrop(date)}
                onPointerDown={(e) => selectStart(date, e, colUser)}
                onPointerMove={selectMove}
                onPointerUp={selectEnd}
                onPointerCancel={() => setSelecting(null)}
              >
                {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => (
                  <div key={i} className="border-t border-border" style={{ height: HOUR_PX }} />
                ))}
                {teamBusyIn(date, colUser).map((b) => {
                  const from = Math.max(b.startMinutes, FIRST_HOUR * 60);
                  const to = Math.min(b.endMinutes, LAST_HOUR * 60);
                  if (to <= from) return null;
                  const person = personOf(colUser);
                  const startUtc = new Date(wallClockToUtc(date, "00:00", timezone).getTime() + b.startMinutes * 60_000);
                  const endUtc = new Date(wallClockToUtc(date, "00:00", timezone).getTime() + b.endMinutes * 60_000);
                  return (
                    <div
                      key={`busy:${b.startMinutes}`}
                      {...hover.bind({
                        title: person ? `Ocupado · ${person.name}` : "Ocupado",
                        lines: [`${formatSlotLabel(startUtc, timezone, timeFormat)} a ${formatSlotLabel(endUtc, timezone, timeFormat)}`, "Según su Google Calendar (sin detalle)"],
                      })}
                      className="absolute inset-x-0.5 rounded-sm bg-muted/80 bg-[repeating-linear-gradient(135deg,var(--border)_0,var(--border)_2px,transparent_2px,transparent_8px)] ring-1 ring-inset ring-border"
                      style={{ top: ((from - FIRST_HOUR * 60) / 60) * HOUR_PX, height: ((to - from) / 60) * HOUR_PX }}
                    >
                      {(to - from) >= 30 && <span className="block px-1.5 pt-0.5 text-[10px] text-muted-foreground">Ocupado</span>}
                    </div>
                  );
                })}
                {date === today && nowMinutes >= FIRST_HOUR * 60 && nowMinutes <= LAST_HOUR * 60 && (
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 z-[6] h-0.5 bg-red-500" style={{ top: ((nowMinutes - FIRST_HOUR * 60) / 60) * HOUR_PX }}>
                    <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-red-500" />
                  </div>
                )}
                {bookingsIn(date, colUser).map((it) => {
                  const item = it.booking as unknown as BookingListItem;
                  const top = ((it.startMinutes - FIRST_HOUR * 60) / 60) * HOUR_PX;
                  const live = resizing?.id === item.id ? resizeDuration(it.startMinutes, resizing.to) : null;
                  const height = Math.max(26, (((live ?? it.endMinutes - it.startMinutes)) / 60) * HOUR_PX);
                  const canDrag = bookingDraggable(item);
                  // Con tareas, lo que se superpone va lado a lado; sin ellas, ancho completo como siempre.
                  const lane = columnsByDate.get(colKey)?.get(`b:${item.id}`);
                  // Un espacio liberado se ve punteado; el resto, con el borde de siempre.
                  const cardClass = item.slotReleasedAt
                    ? "overflow-hidden rounded-md border border-dashed border-violet-400 border-l-2 bg-card px-1.5 py-1 text-left text-[11px] opacity-70 hover:border-ring"
                    : "overflow-hidden rounded-md border border-border border-l-2 bg-card px-1.5 py-1 text-left text-[11px] hover:border-ring";
                  // Con lugar, el estado va como chip de color debajo del nombre; en una tarjeta baja, como un punto de color.
                  const roomy = height >= CHIP_CARD_PX;
                  const card = (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onOpen(item.id)}
                      draggable={canDrag || undefined}
                      onDragStart={canDrag ? (e) => startBooking(item, e) : undefined}
                      onDragEnd={canDrag ? endDrag : undefined}
                      {...hoverBooking(item)}
                      style={{ top, height, borderLeftColor: it.eventColor ?? "var(--primary)", ...(lane ? laneStyle(lane) : null) }}
                      className={lane ? `peer absolute ${cardClass}` : `peer absolute inset-x-1 ${cardClass}`}
                    >
                      <span className="flex items-start gap-1">
                        <span className="min-w-0 flex-1 whitespace-normal break-words font-medium leading-[14px]" style={clampStyle(linesThatFit(height, { reservedPx: roomy ? 16 : 0 }))}>
                          <span className="tabular-nums">{formatSlotLabel(item.startAt, timezone, timeFormat)}</span> {item.contactName || item.bookerName || ""}
                        </span>
                        {!roomy && <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(item.status)}`} />}
                        <HostAvatar item={item} hostNames={hostNames} />
                      </span>
                      {roomy && (
                        <span className="mt-0.5 flex items-center gap-1">
                          <StatusChip status={item.status} small />
                          {item.slotReleasedAt && <span className="truncate text-[10px] text-violet-600 dark:text-violet-300">liberado</span>}
                        </span>
                      )}
                    </button>
                  );
                  return canResize(item) ? (
                    <div key={item.id} className="contents">
                      {card}
                      <div
                        data-cal-handle
                        role="separator"
                        aria-orientation="horizontal"
                        tabIndex={0}
                        aria-label={`Cambiar la duración de ${item.contactName || item.bookerName || "la reunión"}${live !== null ? `: ${durationLabel(live)}` : ""}`}
                        title={live !== null ? durationLabel(live) : "Arrastrá para cambiar la duración"}
                        onPointerDown={(e) => resizeStart(item, it.startMinutes, it.endMinutes, e)}
                        onPointerMove={resizeMove}
                        onPointerUp={() => resizeEnd(item)}
                        onPointerCancel={() => setResizing(null)}
                        onKeyDown={(e) => resizeKey(item, it.startMinutes, it.endMinutes, e)}
                        style={{ top: top + height - 6, height: 10, ...(lane ? laneStyle(lane) : null) }}
                        className={`${RESIZE_HANDLE_CLASS} ${lane ? "" : "inset-x-1"} ${live !== null ? "bg-primary/30 [&>span]:opacity-100" : "hover:bg-primary/15"}`}
                      >
                        <span aria-hidden className={RESIZE_GRIP_CLASS} />
                      </div>
                    </div>
                  ) : (
                    card
                  );
                })}
                {selecting && selecting.date === date && selecting.userId === colUser && (() => {
                  const r = dragCreateRange(selecting.from, selecting.to);
                  return (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-1 z-10 rounded-md border-2 border-dashed border-primary-edge bg-primary/10 px-1.5 py-1 text-[11px] font-medium"
                      style={{ top: ((r.startMinutes - FIRST_HOUR * 60) / 60) * HOUR_PX, height: Math.max(MIN_CARD_PX, (r.durationMinutes / 60) * HOUR_PX) }}
                    >
                      Nueva reunión · {durationLabel(r.durationMinutes)}
                    </div>
                  );
                })()}
                {/* @plantilla-desde(tareas) */}
                {taskPlacement &&
                  (isSelfColumn(colUser) ? (taskPlacement.byDate[date] ?? []) : [])
                    .filter((ti) => ti.timed)
                    .map((ti) => {
                      const lane = columnsByDate.get(colKey)?.get(`t:${ti.task.id}`);
                      const rawTop = (((ti.startMinutes as number) - FIRST_HOUR * 60) / 60) * HOUR_PX;
                      const top = Math.max(0, Math.min(rawTop, (LAST_HOUR - FIRST_HOUR) * HOUR_PX - MIN_CARD_PX));
                      const height = Math.max(MIN_CARD_PX, (ti.durationMinutes / 60) * HOUR_PX);
                      return (
                        <TaskCard
                          key={ti.task.id}
                          item={ti}
                          timeFormat={timeFormat}
                          draggable={taskDraggable(ti.task)}
                          onOpen={openTask}
                          onDragStart={startTask}
                          onDragEnd={endDrag}
                          style={{ top, height, ...(lane ? laneStyle(lane) : null) }}
                          className="absolute"
                          lines={linesThatFit(height)}
                          hover={hover.bind(taskHoverContent(ti, ownerOf(ti.task.owner_id), timeFormat))}
                        />
                      );
                    })}
                {/* @plantilla-hasta(tareas) */}
                {googlePlacement &&
                  (isSelfColumn(colUser) ? (googlePlacement.byDate[date] ?? []) : [])
                    .filter((gi) => gi.timed)
                    .map((gi) => {
                      if (!gi.timed) return null;
                      const lane = columnsByDate.get(colKey)?.get(gi.key);
                      const ev = gi.kind === "event" ? gi.event : null;
                      const live = ev && resizing?.id === `g:${ev.id}` ? resizeDuration(gi.startMinutes, resizing.to) : null;
                      const rawTop = ((gi.startMinutes - FIRST_HOUR * 60) / 60) * HOUR_PX;
                      const top = Math.max(0, Math.min(rawTop, (LAST_HOUR - FIRST_HOUR) * HOUR_PX - MIN_CARD_PX));
                      const height = Math.max(MIN_CARD_PX, ((live ?? gi.endMinutes - gi.startMinutes) / 60) * HOUR_PX);
                      const position = { top, height, ...(lane ? laneStyle(lane) : null) };
                      const card = (
                        <GoogleCard
                          key={gi.key}
                          item={gi}
                          timezone={timezone}
                          timeFormat={timeFormat}
                          ownerName={gi.kind === "busy" ? busyOwner(gi.busy.userId) : undefined}
                          draggable={!!ev && googleDraggable(ev)}
                          onOpen={google!.onOpen}
                          onDragStart={startGoogle}
                          onDragEnd={endDrag}
                          style={position}
                          className={lane ? "peer absolute" : "peer absolute inset-x-1"}
                          lines={linesThatFit(height)}
                          hover={hoverGoogle(gi)}
                        />
                      );
                      if (!ev || !googleResizable(ev)) return card;
                      return (
                        <div key={gi.key} className="contents">
                          {card}
                          <div
                            data-cal-handle
                            role="separator"
                            aria-orientation="horizontal"
                            tabIndex={0}
                            aria-label={`Cambiar la duración de ${ev.summary || "el evento"}${live !== null ? `: ${durationLabel(live)}` : ""}`}
                            title={live !== null ? durationLabel(live) : "Arrastrá para cambiar la duración"}
                            onPointerDown={(e) => googleResizeStart(ev, gi.startMinutes, gi.endMinutes, e)}
                            onPointerMove={resizeMove}
                            onPointerUp={() => googleResizeEnd(ev)}
                            onPointerCancel={() => setResizing(null)}
                            onKeyDown={(e) => googleResizeKey(ev, gi.startMinutes, gi.endMinutes, e)}
                            style={{ top: top + height - 6, height: 10, ...(lane ? laneStyle(lane) : null) }}
                            className={`${RESIZE_HANDLE_CLASS} ${lane ? "" : "inset-x-1"} ${live !== null ? "bg-primary/30 [&>span]:opacity-100" : "hover:bg-primary/15"}`}
                          >
                            <span aria-hidden className={RESIZE_GRIP_CLASS} />
                          </div>
                        </div>
                      );
                    })}
                {ghost && ghostDate === date && (!colUser || items.find((i) => i.id === ghost.bookingId)?.hostUserId === colUser) && (
                  <div
                    aria-label={`Nuevo horario: ${ghost.label}`}
                    className="pointer-events-none absolute inset-x-1 z-10 rounded-md border-2 border-dashed border-primary-edge bg-primary/10 px-1.5 py-1 text-[11px] font-medium"
                    style={{ top: ((ghostMinutes - FIRST_HOUR * 60) / 60) * HOUR_PX, height: Math.max(MIN_CARD_PX, (ghost.durationMinutes / 60) * HOUR_PX) }}
                  >
                    {ghost.label}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Celular: una agenda por día */}
        <ul className="divide-y divide-border md:hidden">
          {days.map((date) => (
            <li key={date} className={date === today ? "bg-primary/[0.08] p-3" : "p-3"}>
              <p className={date === today ? "mb-1.5 text-xs font-semibold text-primary-ink" : "mb-1.5 text-xs font-medium text-muted-foreground"}>{dayLabel(date)}{date === today ? " · Hoy" : ""}</p>
              {/* @plantilla-desde(tareas) */}
              {(placement.byDate[date] ?? []).length === 0 && !(taskPlacement?.byDate[date] ?? []).length && !(googlePlacement?.byDate[date] ?? []).length && <p className="text-xs text-muted-foreground">Sin agendas</p>}
              {/* @plantilla-hasta(tareas) */}
              {/* @plantilla-sin(tareas): {(placement.byDate[date] ?? []).length === 0 && !(googlePlacement?.byDate[date] ?? []).length && <p className="text-xs text-muted-foreground">Sin agendas</p>} */}
              <div className="flex flex-col gap-1.5">
                {(placement.byDate[date] ?? []).map((it) => {
                  const item = it.booking as unknown as BookingListItem;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onOpen(item.id)}
                      style={{ borderLeftColor: it.eventColor ?? "var(--primary)" }}
                      className="flex items-start gap-2 rounded-md border border-border border-l-2 p-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block tabular-nums">{formatSlotLabel(item.startAt, timezone, timeFormat)}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {item.contactName || item.bookerName || "Sin nombre"}
                          <StatusChip status={item.status} small />
                          {item.slotReleasedAt && <span className="text-[10px] text-violet-600 dark:text-violet-300">Espacio liberado</span>}
                        </span>
                      </span>
                      <HostAvatar item={item} hostNames={hostNames} />
                    </button>
                  );
                })}
                {/* @plantilla-desde(tareas) */}
                {taskPlacement &&
                  (taskPlacement.byDate[date] ?? []).map((ti) => (
                    <TaskCard key={ti.task.id} item={ti} timeFormat={timeFormat} draggable={false} onOpen={openTask} onDragStart={startTask} onDragEnd={endDrag} />
                  ))}
                {/* @plantilla-hasta(tareas) */}
                {googlePlacement &&
                  (googlePlacement.byDate[date] ?? []).map((gi) => (
                    <GoogleChip key={gi.key} item={gi} timezone={timezone} timeFormat={timeFormat} ownerName={gi.kind === "busy" ? busyOwner(gi.busy.userId) : undefined} onOpen={google!.onOpen} hover={hoverGoogle(gi)} />
                  ))}
              </div>
            </li>
          ))}
        </ul>
      </>
    )
  );

  return (
    <div className="rounded-xl border border-border">
      {hover.card}
      {dayOpen && (
        <DayAgendaModal
          title={capitalize(new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${dayOpen}T12:00:00Z`)))}
          entries={dayEntries(dayOpen)}
          tasksAvailable={tasksAvailable}
          googleAvailable={googleOn}
          onClose={() => setDayOpen(null)}
          onPick={(entry) => {
            setDayOpen(null);
            if (entry.kind === "booking") onOpen(entry.id);
            else if (entry.kind === "google") google?.onOpen(entry.id);
            else if (entry.kind === "task") openTaskById(entry.id);
          }}
        />
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <h3 className="text-sm font-semibold">{titleFor(view, range, anchor)}</h3>
        <div className="ml-auto flex items-center gap-2">
          {teamControls && (
            <div role="radiogroup" aria-label="Cómo ver el día" className="inline-flex h-8 overflow-hidden rounded-md border border-border text-xs font-medium">
              {[
                { on: true, label: "Por persona" },
                { on: false, label: "Todo junto" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={teamControls.on === o.on}
                  onClick={() => teamControls.onToggle(o.on)}
                  className={teamControls.on === o.on ? "bg-muted px-2.5" : "px-2.5 text-muted-foreground hover:bg-muted"}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {showMenu}
          {google?.on && <GoogleRefresh refreshing={google.refreshing} onRefresh={google.onRefresh} note={google.note} />}
          <button type="button" onClick={() => onAnchor(shiftAnchor(view, anchor, -1))} aria-label="Anterior" className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-muted">
            <ChevronLeft className="h-4 w-4" />
          </button>
          {(() => {
            // «Hoy»: el día, la semana o el mes actual (en la zona de quien mira). Deshabilitado si ya se ve.
            const today = dateInTz(new Date(), timezone);
            const showingToday = today >= range.from && today <= range.to;
            return (
              <button
                type="button"
                onClick={() => onAnchor(today)}
                disabled={showingToday}
                className="h-8 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
              >
                Hoy
              </button>
            );
          })()}
          <button type="button" onClick={() => onAnchor(shiftAnchor(view, anchor, 1))} aria-label="Siguiente" className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-muted">
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Vista del calendario">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                aria-pressed={view === v.key}
                onClick={() => onView(v.key)}
                className={view === v.key ? "rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground" : "rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* @plantilla-desde(tareas) */}
      {tasksOn && wb && taskPlacement ? (
        <div className="flex">
          <div className="min-w-0 flex-1">{content}</div>
          <UndatedPanel tasks={wb.tasks} draggable={isDesktop && canEditTasks} onOpen={openTask} onDragStart={startTask} onDragEnd={endDrag} />
        </div>
      ) : (
        content
      )}
      {/* @plantilla-hasta(tareas) */}
      {/* @plantilla-sin(tareas): {content} */}
    </div>
  );
}

/** Donde va una tarjeta cuando comparte el horario con otras: una columna de las `columns` del grupo. */
function laneStyle(lane: { column: number; columns: number }): React.CSSProperties {
  return { left: `calc(${(lane.column / lane.columns) * 100}% + 4px)`, width: `calc(${100 / lane.columns}% - 8px)` };
}

function titleFor(view: CalendarView, range: { from: string; to: string }, anchor?: string): string {
  if (view === "day") return capitalize(new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${range.from}T12:00:00Z`)));
  if (view === "week") {
    const from = new Date(`${range.from}T12:00:00Z`);
    const to = new Date(`${range.to}T12:00:00Z`);
    const fmt = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", timeZone: "UTC" });
    return `Semana del ${fmt.format(from)} al ${fmt.format(to)}`;
  }
  // El mes que se mira es el del ancla: la grilla arranca el lunes de la primera semana (que puede ser del mes anterior).
  return capitalize(new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${anchor ?? range.from}T12:00:00Z`)));
}

/** La hora actual, actualizada cada minuto (para la línea roja y el día de hoy). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
