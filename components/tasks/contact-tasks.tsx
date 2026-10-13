"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ListChecks } from "lucide-react";
import { ToastProvider } from "@/components/content/drawer/toast";
import type { CompletionPlan } from "@/lib/tasks/core";
import { dueLabel } from "@/lib/tasks/format";
import type { MemberLite } from "@/lib/tasks/table-model";
import type { TaskRow, TaskStatus } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { PersonBadge, StatusIcon, STATUS_TONE } from "./chips";
import { StatusPicker } from "./pickers";
import { QuickCreate } from "./quick-create";
import { ShiftDialog } from "./shift-dialog";
import { useTaskActions } from "./use-task-actions";

/**
 * La seccion «Tareas» de la ficha del contacto (F20): las abiertas y las completadas recientes, con el estado y la fecha
 * editables en la linea, un enlace a la tarea completa y «Agregar tarea», que ya sale vinculada a este contacto.
 */
export function ContactTasks(props: { contactId: string; initialTasks: TaskRow[]; members: MemberLite[]; today: string; canEdit: boolean }) {
  return (
    <ToastProvider>
      <ContactTasksInner {...props} />
    </ToastProvider>
  );
}

function ContactTasksInner({ contactId, initialTasks, members, today, canEdit }: { contactId: string; initialTasks: TaskRow[]; members: MemberLite[]; today: string; canEdit: boolean }) {
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [plan, setPlan] = useState<CompletionPlan | null>(null);
  const actions = useTaskActions({ tasks, setTasks, onPlan: setPlan });
  const names = new Map(members.map((m) => [m.id, m.name]));

  const open = tasks.filter((t) => t.status !== "completed");
  const done = tasks.filter((t) => t.status === "completed");

  return (
    <div className="space-y-2">
      {tasks.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ListChecks className="h-4 w-4" aria-hidden /> Este contacto no tiene tareas.
        </p>
      )}
      {open.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {open.map((t) => (
            <Row key={t.id} task={t} today={today} canEdit={canEdit} busy={actions.busy.has(t.id)} ownerName={t.owner_id ? (names.get(t.owner_id) ?? null) : null} onStatus={(s) => void actions.edit(t.id, { status: s })} onDue={(d) => void actions.edit(t.id, { due_date: d })} />
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Completadas recientes ({done.length})</summary>
          <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
            {done.map((t) => (
              <Row key={t.id} task={t} today={today} canEdit={canEdit} busy={actions.busy.has(t.id)} ownerName={t.owner_id ? (names.get(t.owner_id) ?? null) : null} onStatus={(s) => void actions.edit(t.id, { status: s })} onDue={(d) => void actions.edit(t.id, { due_date: d })} />
            ))}
          </ul>
        </details>
      )}
      {canEdit && (
        <div className="rounded-lg border border-dashed border-border px-2.5 py-0.5">
          <QuickCreate project={null} onCreate={async (title) => !!(await actions.create({ title, contact_id: contactId }))} />
        </div>
      )}
      <Link href="/dashboard/tareas" className="inline-block text-xs text-muted-foreground hover:text-foreground hover:underline">Ver todas las tareas</Link>
      {plan && (
        <ShiftDialog
          plan={plan}
          onClose={() => setPlan(null)}
          onConfirm={async (apply) => {
            const current = plan;
            setPlan(null);
            await actions.finishCompletion(current, apply);
          }}
        />
      )}
    </div>
  );
}

function Row({ task, today, canEdit, busy, ownerName, onStatus, onDue }: { task: TaskRow; today: string; canEdit: boolean; busy: boolean; ownerName: string | null; onStatus: (s: TaskStatus) => void; onDue: (d: string | null) => void }) {
  const [picker, setPicker] = useState(false);
  const [editingDue, setEditingDue] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const label = dueLabel(task, today);
  const tone = label.tone === "overdue" ? "font-medium text-red-600 dark:text-red-400" : label.tone === "today" ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground";

  return (
    <li className={cn("flex items-center gap-2 px-2.5 py-2 text-sm", busy && "opacity-60")} aria-busy={busy || undefined}>
      <button ref={anchor} type="button" disabled={!canEdit} onClick={() => setPicker(true)} aria-label="Cambiar el estado" className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full", STATUS_TONE[task.status], !canEdit && "cursor-default")}>
        <StatusIcon status={task.status} className="h-3.5 w-3.5" />
      </button>
      <Link href={`/dashboard/tareas?task=${task.id}`} className={cn("min-w-0 flex-1 truncate hover:underline", task.status === "completed" && "text-muted-foreground line-through")}>{task.title}</Link>
      {editingDue ? (
        <input
          type="date"
          autoFocus
          defaultValue={task.due_date ?? ""}
          aria-label="Fecha de vencimiento"
          onBlur={(e) => {
            setEditingDue(false);
            const next = e.target.value || null;
            if (next !== task.due_date) onDue(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditingDue(false);
          }}
          className="h-7 w-[8.5rem] rounded-md border border-primary bg-background px-1 text-xs"
        />
      ) : (
        <button type="button" disabled={!canEdit} onClick={() => setEditingDue(true)} aria-label="Cambiar el vencimiento" className={cn("shrink-0 rounded px-1 text-xs tabular-nums hover:bg-accent", tone, !canEdit && "cursor-default hover:bg-transparent")}>
          {label.text}
        </button>
      )}
      <PersonBadge id={task.owner_id} name={ownerName} compact />
      {picker && <StatusPicker anchor={anchor} current={task.status} onPick={(s) => { setPicker(false); onStatus(s); }} onClose={() => setPicker(false)} />}
    </li>
  );
}
