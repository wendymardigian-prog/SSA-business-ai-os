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

import { useMemo, useState, type DragEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BookingListItem } from "@/lib/scheduling/data/bookings";
import { placeInCalendar, type CalendarView } from "@/lib/scheduling/calendar-view";
import { rangeFor, shiftAnchor } from "@/lib/scheduling/calendar-range";
import { capitalize, formatSlotLabel } from "@/lib/scheduling/booker/format";
import { groupOf } from "@/lib/scheduling/booking-status";
import { bookingDropToStartUtc, isSameStart, type BookingDrop } from "@/lib/scheduling/booking-drag";
import { dateInTz, minutesOfDayInTz } from "@/lib/scheduling/time/tz";
import { useToast } from "@/components/content/drawer/toast";
import { useOptionalTaskWorkbench } from "@/components/tasks/task-workbench";
import { placeTasksInCalendar } from "@/lib/tasks/calendar";
import { dropTarget, isSameDrop, movedMessage, snapMinutes, undoPatch, type TaskDropTarget } from "@/lib/tasks/calendar-drag";
import { isDraggableTask, tasksModeParam, type TasksMode } from "@/lib/tasks/calendar-ui";
import { layoutOverlaps, type Span } from "@/lib/tasks/layoutOverlaps";
import type { TaskRow } from "@/lib/tasks/types";
import { TaskCard, TaskMonthChip, TasksToggle, UndatedPanel } from "./calendar-tasks";
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
type Dragging = { kind: "task"; id: string } | { kind: "booking"; id: string };

/** El fantasma de la agenda que se esta reagendando (mientras el modal de confirmacion esta abierto). */
export interface BookingGhost {
  bookingId: string;
  startUtc: string;
  durationMinutes: number;
  label: string;
}

/** Alto minimo de una tarjeta, en pixeles: lo que ocupa aunque dure poco. */
const MIN_CARD_PX = 26;

export function BookingsCalendar({
  items,
  timezone,
  timeFormat,
  view,
  anchor,
  onView,
  onAnchor,
  onOpen,
  taskControls,
  canDragBookings = false,
  onDropBooking,
  ghost = null,
}: {
  items: BookingListItem[];
  timezone: string;
  timeFormat: "12h" | "24h";
  view: CalendarView;
  /** Fecha `YYYY-MM-DD` del día (o del día dentro de la semana o el mes). */
  anchor: string;
  onView: (view: CalendarView) => void;
  onAnchor: (date: string) => void;
  onOpen: (id: string) => void;
  /**
   * Tareas × CRM (R7): el interruptor «Tareas». Sin esto (o con el modo apagado) el calendario es el de siempre y no
   * consulta ni dibuja nada de tareas.
   */
  taskControls?: { mode: TasksMode; onMode: (mode: TasksMode) => void };
  /** R8: las agendas activas se pueden arrastrar (solo escritorio). */
  canDragBookings?: boolean;
  /** R8: se solto una agenda en otro horario o dia. SIEMPRE abre una confirmacion: nada se guarda aca. */
  onDropBooking?: (item: BookingListItem, drop: BookingDrop, startUtc: string) => void;
  ghost?: BookingGhost | null;
}) {
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const wb = useOptionalTaskWorkbench();
  const toast = useToast();
  const isDesktop = useIsDesktop();
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const tasksOn = !!taskControls && taskControls.mode !== "off" && !!wb;

  const placement = useMemo(
    () =>
      placeInCalendar(
        items.map((i) => ({ ...i, status: i.status, start_at: i.startAt, end_at: i.endAt, event_color: i.eventColor })),
        timezone,
        view,
        { range },
      ),
    [items, range, timezone, view],
  );

  const days = Object.keys(placement.byDate).sort();

  // Las tareas (solo con el interruptor encendido).
  const taskPlacement = useMemo(
    () => (tasksOn && wb ? placeTasksInCalendar({ tasks: wb.tasks, workspaceTz: wb.timeZone, viewerTz: timezone, view, range }) : null),
    [tasksOn, wb, timezone, view, range],
  );
  const canEditTasks = !!wb?.canEdit;
  const taskDraggable = (task: TaskRow) => isDesktop && !!wb && isDraggableTask(task, canEditTasks);
  const bookingDraggable = (item: BookingListItem) => isDesktop && canDragBookings && !!onDropBooking && groupOf(item.status) === "active";

  // El reparto lado a lado de lo que se superpone (solo con tareas: sin ellas, el dibujo no cambia).
  const columnsByDate = useMemo(() => {
    const out = new Map<string, Map<string, { column: number; columns: number }>>();
    if (!taskPlacement) return out;
    const minMinutes = Math.ceil((MIN_CARD_PX / HOUR_PX) * 60);
    for (const date of days) {
      const spans: Span[] = [
        ...(placement.byDate[date] ?? []).map((it) => ({ id: `b:${(it.booking as unknown as BookingListItem).id}`, start: it.startMinutes, end: it.endMinutes })),
        ...(taskPlacement.byDate[date] ?? []).filter((i) => i.timed).map((i) => ({ id: `t:${i.task.id}`, start: i.startMinutes as number, end: i.endMinutes as number })),
      ];
      out.set(date, new Map(layoutOverlaps(spans, minMinutes).map((p) => [p.id, { column: p.column, columns: p.columns }])));
    }
    return out;
  }, [taskPlacement, placement, days]);

  // ── Arrastre ──────────────────────────────────────────────────────────────
  function startTask(task: TaskRow, e: DragEvent<HTMLElement>) {
    e.dataTransfer.setData("text/plain", task.id);
    e.dataTransfer.effectAllowed = "move";
    setDragging({ kind: "task", id: task.id });
  }
  function startBooking(item: BookingListItem, e: DragEvent<HTMLElement>) {
    e.dataTransfer.setData("text/plain", item.id);
    e.dataTransfer.effectAllowed = "move";
    setDragging({ kind: "booking", id: item.id });
  }
  const endDrag = () => setDragging(null);

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
        text: movedMessage(patch, timeFormat, wb.today),
        action: { label: "Deshacer", onClick: () => void wb.actions.edit(task.id, undoPatch(before)) },
      });
    });
  }

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
    if (current.kind === "task") dropTask(current.id, target);
    else if (target.kind !== "allday") dropBooking(current.id, target);
  }

  /** ¿Este destino acepta lo que se esta arrastrando? (La franja «Sin hora» solo acepta tareas.) */
  const accepts = (kind: "slot" | "allday" | "day") => !!dragging && (dragging.kind === "task" || kind !== "allday");
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

  const openTask = (id: string) => wb?.openTask(id);
  const ghostDate = ghost ? dateInTz(ghost.startUtc, timezone) : null;
  const ghostMinutes = ghost ? minutesOfDayInTz(ghost.startUtc, timezone) : 0;

  const content = (
    view === "month" ? (
      <div className="grid grid-cols-7 gap-px bg-border p-px">
        {days.map((date) => (
          <div key={date} className="min-h-24 bg-card p-1.5" {...cellDrop(date)}>
            <p className="mb-1 text-xs text-muted-foreground">{dayLabel(date)}</p>
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
                    className="truncate rounded border-l-2 bg-muted/60 px-1.5 py-0.5 text-left text-[11px] hover:bg-muted"
                  >
                    {formatSlotLabel(item.startAt, timezone, timeFormat)} {item.contactName || item.bookerName || ""}
                  </button>
                );
              })}
              {taskPlacement &&
                (taskPlacement.byDate[date] ?? []).map((ti) => (
                  <TaskMonthChip key={ti.task.id} item={ti} timeFormat={timeFormat} draggable={taskDraggable(ti.task)} onOpen={openTask} onDragStart={startTask} onDragEnd={endDrag} />
                ))}
              {ghost && ghostDate === date && view === "month" && (
                <span className="truncate rounded border border-dashed border-primary bg-primary/10 px-1.5 py-0.5 text-[11px]">{ghost.label}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <>
        {/* Escritorio: rejilla por hora */}
        <div className="hidden overflow-x-auto md:block">
          <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
            <div />
            {days.map((date) => (
              <div key={date} className="border-b border-border p-2 text-center text-xs font-medium">
                {dayLabel(date)}
              </div>
            ))}
            {taskPlacement && (
              <>
                <div className="border-b border-border pr-2 pt-1.5 text-right text-[11px] text-muted-foreground">Sin hora</div>
                {days.map((date) => (
                  <div key={date} aria-label={`Tareas sin hora, ${dayLabel(date)}`} className="flex min-h-9 flex-col gap-1 border-b border-l border-border p-1" {...stripDrop(date)}>
                    {(taskPlacement.byDate[date] ?? [])
                      .filter((ti) => !ti.timed)
                      .map((ti) => (
                        <TaskCard key={ti.task.id} item={ti} timeFormat={timeFormat} draggable={taskDraggable(ti.task)} onOpen={openTask} onDragStart={startTask} onDragEnd={endDrag} compact />
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
            {days.map((date) => (
              <div key={date} className="relative border-l border-border" {...columnDrop(date)}>
                {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => (
                  <div key={i} className="border-t border-border" style={{ height: HOUR_PX }} />
                ))}
                {(placement.byDate[date] ?? []).map((it) => {
                  const item = it.booking as unknown as BookingListItem;
                  const top = ((it.startMinutes - FIRST_HOUR * 60) / 60) * HOUR_PX;
                  const height = Math.max(26, ((it.endMinutes - it.startMinutes) / 60) * HOUR_PX);
                  const canDrag = bookingDraggable(item);
                  // Con tareas, lo que se superpone va lado a lado; sin ellas, ancho completo como siempre.
                  const lane = columnsByDate.get(date)?.get(`b:${item.id}`);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onOpen(item.id)}
                      draggable={canDrag || undefined}
                      onDragStart={canDrag ? (e) => startBooking(item, e) : undefined}
                      onDragEnd={canDrag ? endDrag : undefined}
                      style={{ top, height, borderLeftColor: it.eventColor ?? "var(--primary)", ...(lane ? laneStyle(lane) : null) }}
                      className={lane ? "absolute overflow-hidden rounded-md border border-border border-l-2 bg-card px-1.5 py-1 text-left text-[11px] hover:border-ring" : "absolute inset-x-1 overflow-hidden rounded-md border border-border border-l-2 bg-card px-1.5 py-1 text-left text-[11px] hover:border-ring"}
                    >
                      <span className="block truncate font-medium tabular-nums">
                        {formatSlotLabel(item.startAt, timezone, timeFormat)} {item.contactName || item.bookerName || ""}
                      </span>
                      <span className="block truncate text-muted-foreground">{it.statusLabel}</span>
                    </button>
                  );
                })}
                {taskPlacement &&
                  (taskPlacement.byDate[date] ?? [])
                    .filter((ti) => ti.timed)
                    .map((ti) => {
                      const lane = columnsByDate.get(date)?.get(`t:${ti.task.id}`);
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
                        />
                      );
                    })}
                {ghost && ghostDate === date && (
                  <div
                    aria-label={`Nuevo horario: ${ghost.label}`}
                    className="pointer-events-none absolute inset-x-1 z-10 rounded-md border-2 border-dashed border-primary bg-primary/10 px-1.5 py-1 text-[11px] font-medium"
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
            <li key={date} className="p-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{dayLabel(date)}</p>
              {(placement.byDate[date] ?? []).length === 0 && !(taskPlacement?.byDate[date] ?? []).length && <p className="text-xs text-muted-foreground">Sin agendas</p>}
              <div className="flex flex-col gap-1.5">
                {(placement.byDate[date] ?? []).map((it) => {
                  const item = it.booking as unknown as BookingListItem;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onOpen(item.id)}
                      style={{ borderLeftColor: it.eventColor ?? "var(--primary)" }}
                      className="rounded-md border border-border border-l-2 p-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="block tabular-nums">{formatSlotLabel(item.startAt, timezone, timeFormat)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {item.contactName || item.bookerName || "Sin nombre"} · {it.statusLabel}
                      </span>
                    </button>
                  );
                })}
                {taskPlacement &&
                  (taskPlacement.byDate[date] ?? []).map((ti) => (
                    <TaskCard key={ti.task.id} item={ti} timeFormat={timeFormat} draggable={false} onOpen={openTask} onDragStart={startTask} onDragEnd={endDrag} />
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
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <h3 className="text-sm font-semibold">{titleFor(view, range)}</h3>
        <span className="text-xs text-muted-foreground">Las canceladas no se muestran</span>
        <div className="ml-auto flex items-center gap-2">
          {taskControls && <TasksToggle mode={taskControls.mode} onMode={taskControls.onMode} />}
          <button type="button" onClick={() => onAnchor(shiftAnchor(view, anchor, -1))} aria-label="Anterior" className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-muted">
            <ChevronLeft className="h-4 w-4" />
          </button>
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

      {tasksOn && wb && taskPlacement ? (
        <div className="flex">
          <div className="min-w-0 flex-1">{content}</div>
          <UndatedPanel tasks={wb.tasks} draggable={isDesktop && canEditTasks} onOpen={openTask} onDragStart={startTask} onDragEnd={endDrag} />
        </div>
      ) : (
        content
      )}
    </div>
  );
}

/** Donde va una tarjeta cuando comparte el horario con otras: una columna de las `columns` del grupo. */
function laneStyle(lane: { column: number; columns: number }): React.CSSProperties {
  return { left: `calc(${(lane.column / lane.columns) * 100}% + 4px)`, width: `calc(${100 / lane.columns}% - 8px)` };
}

function titleFor(view: CalendarView, range: { from: string; to: string }): string {
  if (view === "day") return capitalize(new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${range.from}T12:00:00Z`)));
  if (view === "week") {
    const from = new Date(`${range.from}T12:00:00Z`);
    const to = new Date(`${range.to}T12:00:00Z`);
    const fmt = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", timeZone: "UTC" });
    return `Semana del ${fmt.format(from)} al ${fmt.format(to)}`;
  }
  return capitalize(new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${range.from}T12:00:00Z`)));
}
