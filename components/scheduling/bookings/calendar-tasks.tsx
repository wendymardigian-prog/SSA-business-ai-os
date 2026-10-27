"use client";

import { useState, type DragEvent } from "react";
import { CheckSquare, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { PRIORITY_DOT, STATUS_BORDER, monthChipText, undatedTasks, type TasksMode } from "@/lib/tasks/calendar-ui";
import type { CalendarTaskItem } from "@/lib/tasks/calendar";
import type { TimeFormat } from "@/lib/calendar/time";
import { formatTime } from "@/lib/calendar/time";
import { PRIORITY_LABELS, STATUS_LABELS, type TaskRow } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

/**
 * Las piezas de las tareas en el calendario de Agenda (Tareas × CRM, R7): el interruptor, la tarjeta de una tarea, el chip
 * del mes y el panel «Sin fecha». Distintas de las agendas a simple vista: borde punteado, icono de casilla, un punto por
 * prioridad y el color del estado; las completadas, atenuadas y tachadas.
 */

/** El interruptor «Tareas» (apagado / mias / todas) de la cabecera del calendario. */
export function TasksToggle({ mode, onMode }: { mode: TasksMode; onMode: (mode: TasksMode) => void }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Tareas en el calendario">
      <button
        type="button"
        aria-pressed={mode !== "off"}
        onClick={() => onMode(mode === "off" ? "mine" : "off")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
          mode !== "off" ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
        )}
      >
        <CheckSquare className="h-3.5 w-3.5" aria-hidden /> Tareas
      </button>
      {mode !== "off" && (
        <select aria-label="Qué tareas mostrar" value={mode} onChange={(e) => onMode(e.target.value as TasksMode)} className="h-7 rounded-md border border-input bg-background px-1.5 text-xs">
          <option value="mine">Mías</option>
          <option value="all">Todas las que veo</option>
        </select>
      )}
    </div>
  );
}

interface CardProps {
  item: CalendarTaskItem;
  timeFormat: TimeFormat;
  /** Se puede arrastrar (escritorio + permiso + no completada). */
  draggable: boolean;
  onOpen: (id: string) => void;
  onDragStart: (task: TaskRow, e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  style?: React.CSSProperties;
  className?: string;
  /** Una linea mas: el estado. */
  compact?: boolean;
}

/** Una tarea en la rejilla horaria o en la franja «Sin hora». */
export function TaskCard({ item, timeFormat, draggable, onOpen, onDragStart, onDragEnd, style, className, compact = false }: CardProps) {
  const { task } = item;
  const done = task.status === "completed";
  return (
    <button
      type="button"
      data-task={task.id}
      draggable={draggable || undefined}
      onDragStart={draggable ? (e) => onDragStart(task, e) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={() => onOpen(task.id)}
      style={style}
      aria-label={`Tarea: ${task.title}`}
      className={cn(
        "flex items-start gap-1 overflow-hidden rounded-md border border-dashed border-l-4 bg-card px-1.5 py-1 text-left text-[11px] hover:border-ring",
        STATUS_BORDER[task.status],
        done && "opacity-60",
        draggable && "cursor-grab active:cursor-grabbing",
        className,
      )}
    >
      <CheckSquare className="mt-px h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate font-medium", done && "line-through")}>
          {item.timed && <span className="mr-1 tabular-nums text-muted-foreground">{formatTime(minutesToHHMM(item.startMinutes as number), timeFormat)}</span>}
          {task.title}
        </span>
        {!compact && <span className="block truncate text-muted-foreground">{STATUS_LABELS[task.status]}</span>}
      </span>
      <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", PRIORITY_DOT[task.priority])} title={`Prioridad ${PRIORITY_LABELS[task.priority].toLowerCase()}`} />
    </button>
  );
}

function minutesToHHMM(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Una tarea en una celda del mes. */
export function TaskMonthChip({ item, timeFormat, draggable, onOpen, onDragStart, onDragEnd }: Omit<CardProps, "style" | "className" | "compact">) {
  const { task } = item;
  const done = task.status === "completed";
  return (
    <button
      type="button"
      data-task={task.id}
      draggable={draggable || undefined}
      onDragStart={draggable ? (e) => onDragStart(task, e) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={() => onOpen(task.id)}
      aria-label={`Tarea: ${task.title}`}
      className={cn("flex items-center gap-1 truncate rounded border border-dashed border-l-4 bg-card px-1.5 py-0.5 text-left text-[11px] hover:bg-muted", STATUS_BORDER[task.status], done && "line-through opacity-60", draggable && "cursor-grab")}
    >
      <CheckSquare className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{monthChipText(task, timeFormat)}</span>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])} />
    </button>
  );
}

/** El panel plegable «Sin fecha» (solo escritorio): las tareas abiertas sin fecha, para arrastrarlas al calendario. */
export function UndatedPanel({
  tasks,
  draggable,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  tasks: readonly TaskRow[];
  draggable: boolean;
  onOpen: (id: string) => void;
  onDragStart: (task: TaskRow, e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const { rows, total } = undatedTasks(tasks, query);

  if (!open) {
    return (
      <aside className="hidden shrink-0 border-l border-border md:block">
        <button type="button" onClick={() => setOpen(true)} aria-label="Mostrar las tareas sin fecha" className="grid h-full w-9 place-items-start justify-center pt-3 text-muted-foreground hover:bg-muted">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
      </aside>
    );
  }
  return (
    <aside aria-label="Tareas sin fecha" className="hidden w-60 shrink-0 flex-col border-l border-border md:flex">
      <div className="flex items-center gap-1 border-b border-border p-2">
        <h4 className="min-w-0 flex-1 text-xs font-semibold">Sin fecha <span className="font-normal text-muted-foreground">({total})</span></h4>
        <button type="button" onClick={() => setOpen(false)} aria-label="Ocultar las tareas sin fecha" className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="relative border-b border-border p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por título" aria-label="Buscar tareas sin fecha" className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs" />
      </div>
      <ul className="max-h-[32rem] flex-1 space-y-1 overflow-y-auto p-2">
        {rows.length === 0 && <li className="px-1 py-2 text-xs text-muted-foreground">{query ? "Ninguna coincide." : "No hay tareas abiertas sin fecha."}</li>}
        {rows.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              draggable={draggable || undefined}
              onDragStart={draggable ? (e) => onDragStart(t, e) : undefined}
              onDragEnd={draggable ? onDragEnd : undefined}
              onClick={() => onOpen(t.id)}
              className={cn("flex w-full items-center gap-1.5 rounded-md border border-dashed border-l-4 bg-card px-2 py-1.5 text-left text-xs hover:border-ring", STATUS_BORDER[t.status], draggable && "cursor-grab")}
            >
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className={cn("h-2 w-2 shrink-0 rounded-full", PRIORITY_DOT[t.priority])} />
            </button>
          </li>
        ))}
        {total > rows.length && <li className="px-1 text-[11px] text-muted-foreground">Mostrando {rows.length} de {total}. Buscá para acotar.</li>}
      </ul>
      {draggable && <p className="border-t border-border p-2 text-[11px] text-muted-foreground">Arrastrá una tarea al calendario para darle día (y hora).</p>}
    </aside>
  );
}
