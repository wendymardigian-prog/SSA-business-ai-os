"use client";

import { useRef, useState } from "react";
import { dueLabel } from "@/lib/tasks/format";
import type { TaskRow, TaskStatus } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { PersonBadge, StatusIcon, STATUS_TONE } from "./chips";
import { StatusPicker } from "./pickers";
import type { TaskWorkbenchApi } from "./task-workbench";

/**
 * Una tarea en una linea, para la ficha del contacto, el panel de la bandeja y el campo de seguimiento (Tareas × CRM):
 * el estado y la fecha se cambian sin abrirla (con los mismos caminos que la tabla, incluido el dialogo de mover fechas) y
 * el titulo abre el drawer sin salir de la pagina. Sin `tasks.edit`, los controles son de solo lectura.
 */
export function TaskLine({ task, wb, ownerName }: { task: TaskRow; wb: TaskWorkbenchApi; ownerName: string | null }) {
  const { today, canEdit } = wb;
  const busy = wb.actions.busy.has(task.id);
  const [picker, setPicker] = useState(false);
  const [editingDue, setEditingDue] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const label = dueLabel(task, today);
  const tone = label.tone === "overdue" ? "font-medium text-red-600 dark:text-red-400" : label.tone === "today" ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground";
  const setStatus = (s: TaskStatus) => void wb.actions.edit(task.id, { status: s });
  const setDue = (d: string | null) => void wb.actions.edit(task.id, { due_date: d });

  return (
    <li className={cn("flex items-center gap-2 px-2.5 py-2 text-sm", busy && "opacity-60")} aria-busy={busy || undefined}>
      <button ref={anchor} type="button" disabled={!canEdit} onClick={() => setPicker(true)} aria-label="Cambiar el estado" className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full", STATUS_TONE[task.status], !canEdit && "cursor-default")}>
        <StatusIcon status={task.status} className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={(e) => wb.openTask(task.id, e.currentTarget)} className={cn("min-w-0 flex-1 truncate text-left hover:underline", task.status === "completed" && "text-muted-foreground line-through")}>{task.title}</button>
      {editingDue ? (
        <input
          type="date"
          autoFocus
          defaultValue={task.due_date ?? ""}
          aria-label="Fecha de vencimiento"
          onBlur={(e) => {
            setEditingDue(false);
            const next = e.target.value || null;
            if (next !== task.due_date) setDue(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditingDue(false);
          }}
          className="h-7 w-[8.5rem] shrink-0 rounded-md border border-primary bg-background px-1 text-xs"
        />
      ) : (
        <button type="button" disabled={!canEdit} onClick={() => setEditingDue(true)} aria-label="Cambiar el vencimiento" className={cn("shrink-0 rounded px-1 text-xs tabular-nums hover:bg-accent", tone, !canEdit && "cursor-default hover:bg-transparent")}>
          {label.text}
        </button>
      )}
      <PersonBadge id={task.owner_id} name={ownerName} compact />
      {picker && <StatusPicker anchor={anchor} current={task.status} onPick={(s) => { setPicker(false); setStatus(s); }} onClose={() => setPicker(false)} />}
    </li>
  );
}
