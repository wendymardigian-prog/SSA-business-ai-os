"use client";

import { useRef, useState, type DragEvent } from "react";
import { GripVertical, Lock, MoreHorizontal, Users } from "lucide-react";
import { dueLabel, formatSource, type SourceContext } from "@/lib/tasks/format";
import type { TaskRowView } from "@/lib/tasks/table-model";
import { STATUS_LABELS, TASK_STATUSES, type TaskStatus } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { PersonBadge, PriorityChip, StatusChip, StatusIcon, STATUS_TONE } from "./chips";
import { FloatingPanel } from "./floating";
import { useTimeFormat } from "./time-format-context";

export interface TaskCardProps {
  view: TaskRowView;
  today: string;
  canEdit: boolean;
  busy: boolean;
  source: SourceContext;
  /** `board`: tarjeta del tablero (arrastrable). `list`: tarjeta de la lista del celular. */
  variant: "board" | "list";
  onOpen: (origin: HTMLElement | null) => void;
  /** Cambiar el estado (el menu «Mover a…»). */
  onStatus: (status: TaskStatus) => void;
  /** Cambiar la fecha de vencimiento. */
  onDue: (due: string | null) => void;
  dragging?: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
}

const toneClass: Record<ReturnType<typeof dueLabel>["tone"], string> = {
  overdue: "font-medium text-red-600 dark:text-red-400",
  today: "font-medium text-amber-700 dark:text-amber-300",
  soon: "text-foreground",
  normal: "text-muted-foreground",
  none: "text-muted-foreground",
  done: "text-muted-foreground",
};

/**
 * Una tarjeta: titulo, responsable, vencimiento (en rojo si esta vencida), proyecto, candado si esta bloqueada y
 * cuantos seguidores tiene. Sin mouse: el menu «Mover a…» (y la fecha) hacen lo mismo que arrastrar o editar la celda.
 */
export function TaskCard({ view, today, canEdit, busy, source, variant, onOpen, onStatus, onDue, dragging, onDragStart, onDragEnd }: TaskCardProps) {
  const root = useRef<HTMLElement>(null);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [date, setDate] = useState(view.dueDate ?? "");
  const timeFormat = useTimeFormat();
  const label = dueLabel({ due_date: view.dueDate, due_time: view.dueTime, status: view.status }, today, timeFormat);
  const origin = formatSource(view.task, source);

  return (
    <article
      ref={root}
      data-card={view.id}
      draggable={variant === "board" && canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-busy={busy || undefined}
      className={cn(
        "group relative rounded-xl border border-border bg-card p-3 text-card-foreground shadow-sm transition-opacity",
        dragging && "opacity-40",
        busy && "opacity-60",
        variant === "board" && canEdit && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-start gap-2">
        {variant === "board" && canEdit && <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />}
        <button
          type="button"
          onClick={() => onOpen(root.current)}
          className={cn("min-w-0 flex-1 text-left text-sm font-medium leading-snug hover:underline focus-visible:underline focus-visible:outline-none", view.status === "completed" && "text-muted-foreground line-through")}
        >
          <span className="line-clamp-3 break-words">{view.title}</span>
        </button>
        {canEdit && (
          <button
            ref={menuAnchor}
            type="button"
            onClick={() => setMenu((v) => !v)}
            aria-label={`Mover o cambiar la fecha de ${view.title}`}
            aria-haspopup="dialog"
            aria-expanded={menu}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        {variant === "list" && <StatusChip status={view.status} />}
        <span className={cn("tabular-nums", toneClass[label.tone])}>{label.text}</span>
        {view.priority !== "normal" && <PriorityChip priority={view.priority} />}
        {view.project && <span className="max-w-[10rem] truncate rounded-md bg-muted px-1.5 py-0.5">{view.project}</span>}
        {view.blocked && (
          <span title={`Bloqueada por ${view.blockedCount} ${view.blockedCount === 1 ? "tarea" : "tareas"} sin completar`} className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Bloqueada por {view.blockedCount} {view.blockedCount === 1 ? "tarea" : "tareas"} sin completar</span>
          </span>
        )}
        {view.followerCount > 0 && (
          <span className="inline-flex items-center gap-1 text-muted-foreground" title={`${view.followerCount} ${view.followerCount === 1 ? "seguidor" : "seguidores"}`}>
            <Users className="h-3.5 w-3.5" aria-hidden />
            {view.followerCount}
          </span>
        )}
        {origin.label !== "Manual" && <span className="text-muted-foreground">{origin.label}</span>}
        <span className="ml-auto">
          <PersonBadge id={view.ownerId} name={view.ownerName} compact />
        </span>
      </div>

      {menu && (
        <FloatingPanel anchor={menuAnchor} onClose={() => setMenu(false)} label="Mover o cambiar la fecha" width={250}>
          <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mover a…</p>
          {TASK_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={s === view.status}
              onClick={() => {
                setMenu(false);
                onStatus(s);
              }}
              className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50", s === view.status && "font-medium")}
            >
              <span className={cn("grid h-5 w-5 place-items-center rounded-full", STATUS_TONE[s])}>
                <StatusIcon status={s} className="h-3.5 w-3.5" />
              </span>
              {STATUS_LABELS[s]}
              {s === view.status && <span className="ml-auto text-xs text-muted-foreground">Acá está</span>}
            </button>
          ))}
          <div className="mt-1 border-t border-border px-2 pt-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" htmlFor={`due-${view.id}`}>Vencimiento</label>
            <input
              id={`due-${view.id}`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
            />
            <div className="mt-1.5 flex gap-1.5 pb-1">
              <button
                type="button"
                disabled={(date || null) === view.dueDate}
                onClick={() => {
                  setMenu(false);
                  onDue(date || null);
                }}
                className="h-7 flex-1 rounded-lg bg-primary px-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Guardar fecha
              </button>
              {view.dueDate && (
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    onDue(null);
                  }}
                  className="h-7 rounded-lg border border-border px-2 text-xs hover:bg-accent"
                >
                  Quitar
                </button>
              )}
            </div>
          </div>
        </FloatingPanel>
      )}
    </article>
  );
}
