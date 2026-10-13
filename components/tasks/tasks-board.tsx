"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Plus } from "lucide-react";
import { dropIndex, groupByStatus, planMove, type MovePlan } from "@/lib/tasks/kanban-model";
import type { SourceContext } from "@/lib/tasks/format";
import type { TaskRowView } from "@/lib/tasks/table-model";
import { STATUS_LABELS, TASK_STATUSES, type TaskStatus } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { QuickCreate } from "./quick-create";
import { STATUS_TONE, StatusIcon } from "./chips";
import { TaskCard } from "./task-card";

export interface TasksBoardProps {
  /** Las tareas ya filtradas, como filas de la vista (con responsable, vencida, bloqueada). */
  rows: TaskRowView[];
  today: string;
  canEdit: boolean;
  busy: ReadonlySet<string>;
  source: SourceContext;
  onOpen: (taskId: string, origin: HTMLElement | null) => void;
  onStatus: (taskId: string, status: TaskStatus) => void;
  onDue: (taskId: string, due: string | null) => void;
  /** Aplica el plan de un movimiento: estado + posiciones. */
  onMove: (taskId: string, plan: MovePlan) => void;
  /** Crea una tarea en la columna (con su estado). */
  onQuickCreate: (title: string, project: string | null, status: TaskStatus) => Promise<boolean>;
}

/**
 * El tablero por estado (F16): tres columnas, tarjetas que se arrastran con HTML5 nativo (el mismo patron que el
 * tablero de Contenido, sin libreria) y un menu «Mover a…» en cada tarjeta para quien no usa el mouse.
 * Arrastrar a «Completada» pasa por la vista previa de fechas (`onMove` decide).
 */
export function TasksBoard({ rows, today, canEdit, busy, source, onOpen, onStatus, onDue, onMove, onQuickCreate }: TasksBoardProps) {
  const viewById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const columns = useMemo(() => groupByStatus(rows.map((r) => r.task)), [rows]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ status: TaskStatus; index: number } | null>(null);
  const lists = useRef<Partial<Record<TaskStatus, HTMLDivElement | null>>>({});

  // Red de seguridad: si el arrastre termina en cualquier lado (se suelta fuera, Esc), no queda nada «arrastrando».
  useEffect(() => {
    if (!dragging) return;
    const reset = () => {
      setDragging(null);
      setOver(null);
    };
    document.addEventListener("dragend", reset);
    document.addEventListener("drop", reset);
    document.addEventListener("pointerdown", reset);
    return () => {
      document.removeEventListener("dragend", reset);
      document.removeEventListener("drop", reset);
      document.removeEventListener("pointerdown", reset);
    };
  }, [dragging]);

  function indexAt(status: TaskStatus, y: number): number {
    const nodes = [...(lists.current[status]?.querySelectorAll<HTMLElement>("[data-card]") ?? [])].filter((n) => n.dataset.card !== dragging);
    return dropIndex(nodes.map((n) => { const r = n.getBoundingClientRect(); return r.top + r.height / 2; }), y);
  }

  function onDragOver(e: DragEvent<HTMLElement>, status: TaskStatus) {
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const index = indexAt(status, e.clientY);
    setOver((prev) => (prev && prev.status === status && prev.index === index ? prev : { status, index }));
  }

  function onDrop(e: DragEvent<HTMLElement>, status: TaskStatus) {
    if (!dragging) return;
    e.preventDefault();
    const plan = planMove(columns, dragging, status, indexAt(status, e.clientY));
    const id = dragging;
    setDragging(null);
    setOver(null);
    if (plan) onMove(id, plan);
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
      <div className="grid min-w-[880px] grid-cols-3 gap-3 md:min-w-0">
        {TASK_STATUSES.map((status) => {
          const cards = columns[status];
          const visibleCount = cards.filter((c) => c.id !== dragging).length;
          let visibleSlot = 0;
          return (
            <section
              key={status}
              aria-label={`${STATUS_LABELS[status]}: ${cards.length}`}
              onDragOver={(e) => onDragOver(e, status)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o?.status === status ? null : o));
              }}
              onDrop={(e) => onDrop(e, status)}
              className={cn("flex min-h-[200px] flex-col rounded-xl border border-border bg-muted/30 p-2 transition-colors", over?.status === status && "border-primary/60 bg-primary/5")}
            >
              <header className="flex items-center gap-2 px-1 pb-2 pt-1">
                <span className={cn("grid h-6 w-6 place-items-center rounded-full", STATUS_TONE[status])}>
                  <StatusIcon status={status} className="h-3.5 w-3.5" />
                </span>
                <h2 className="text-sm font-semibold">{STATUS_LABELS[status]}</h2>
                <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{cards.length}</span>
              </header>
              <div ref={(el) => { lists.current[status] = el; }} className="flex min-h-[60px] flex-1 flex-col gap-2">
                {cards.map((card) => {
                  const view = viewById.get(card.id);
                  if (!view) return null;
                  // El indice de destino cuenta SIN la tarjeta que se arrastra (sigue en pantalla, atenuada).
                  const slot = card.id === dragging ? -1 : visibleSlot++;
                  return (
                    <div key={card.id} className="contents">
                      {slot >= 0 && over?.status === status && over.index === slot && <DropMarker />}
                      <TaskCard
                        view={view}
                        today={today}
                        canEdit={canEdit}
                        busy={busy.has(card.id)}
                        source={source}
                        variant="board"
                        onOpen={(origin) => onOpen(card.id, origin)}
                        onStatus={(s) => onStatus(card.id, s)}
                        onDue={(d) => onDue(card.id, d)}
                        dragging={dragging === card.id}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", card.id);
                          setDragging(card.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                      />
                    </div>
                  );
                })}
                {over?.status === status && over.index >= visibleCount && <DropMarker />}
                {cards.length === 0 && !over && <p className="px-2 py-6 text-center text-xs text-muted-foreground">Sin tareas</p>}
                {/* Si se arrastra la unica tarjeta de la columna, el marcador de destino igual aparece. */}
              </div>
              {canEdit && status !== "completed" && (
                <div className="mt-2 rounded-lg px-1">
                  <QuickCreate project={null} onCreate={(title, project) => onQuickCreate(title, project, status)} />
                </div>
              )}
              {status === "completed" && cards.length === 0 && canEdit && (
                <p className="flex items-center gap-1 px-2 pb-2 text-xs text-muted-foreground"><Plus className="h-3 w-3" aria-hidden /> Arrastrá una tarea acá para completarla.</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function DropMarker() {
  return <div aria-hidden className="h-1 rounded-full bg-primary" />;
}
