"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ListChecks, Plus } from "lucide-react";
import { tasksForContact } from "@/lib/tasks/contact-tasks";
import { dueLabel } from "@/lib/tasks/format";
import type { MemberLite } from "@/lib/tasks/table-model";
import type { TaskRow, TaskStatus } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { PersonBadge, StatusIcon, STATUS_TONE } from "./chips";
import { StatusPicker } from "./pickers";
import { TaskWorkbench, type TaskWorkbenchApi } from "./task-workbench";

export interface ContactTasksProps {
  contactId: string;
  /** Para el drawer al crear («Contacto: …»). */
  contactName?: string | null;
  initialTasks: TaskRow[];
  members: MemberLite[];
  currentUserId: string;
  /** AAAA-MM-DD en la zona del workspace. */
  today: string;
  timeZone: string;
  canEdit: boolean;
  canDelete: boolean;
  /** No se pudieron leer las tareas: se muestra un error con «Reintentar», no «sin tareas». */
  loadError?: boolean;
  onRetry?: () => void;
}

/**
 * La seccion «Tareas» de un contacto, compartida por la ficha y el panel de la bandeja (Tareas × CRM, R1): las abiertas
 * por vencimiento y las ultimas 5 completadas, con el estado y la fecha editables sin abrir la tarea, «Agregar tarea»
 * (abre el drawer ya vinculado al contacto) y el titulo, que abre el drawer sin salir de la pagina.
 */
export function ContactTasks(props: ContactTasksProps) {
  const { contactId, contactName, loadError, onRetry, canEdit, today } = props;
  return (
    <TaskWorkbench
      initialTasks={props.initialTasks}
      members={props.members}
      currentUserId={props.currentUserId}
      today={today}
      timeZone={props.timeZone}
      canEdit={canEdit}
      canDelete={props.canDelete}
      contactNames={contactName ? { [contactId]: contactName } : undefined}
    >
      {(wb) => <Body wb={wb} contactId={contactId} members={props.members} today={today} canEdit={canEdit} loadError={loadError} onRetry={onRetry} />}
    </TaskWorkbench>
  );
}

function Body({ wb, contactId, members, today, canEdit, loadError, onRetry: onRetryProp }: { wb: TaskWorkbenchApi; contactId: string; members: MemberLite[]; today: string; canEdit: boolean; loadError?: boolean; onRetry?: () => void }) {
  const router = useRouter();
  const onRetry = onRetryProp ?? (() => router.refresh());
  const { open, done } = tasksForContact(wb.tasks, contactId);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const empty = open.length === 0 && done.length === 0;
  const add = canEdit ? (
    <button
      type="button"
      onClick={() => wb.startCreate({ contact_id: contactId })}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
    >
      <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar tarea
    </button>
  ) : null;

  if (loadError && empty) {
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
        <p>No pude cargar las tareas de este contacto.</p>
        <button type="button" onClick={onRetry} className="h-8 rounded-lg border border-red-500/40 px-3 text-xs hover:bg-red-500/10">Reintentar</button>
      </div>
    );
  }

  const row = (t: TaskRow) => (
    <Row
      key={t.id}
      task={t}
      today={today}
      canEdit={canEdit}
      busy={wb.actions.busy.has(t.id)}
      ownerName={t.owner_id ? (names.get(t.owner_id) ?? null) : null}
      onOpen={(el) => wb.openTask(t.id, el)}
      onStatus={(s) => void wb.actions.edit(t.id, { status: s })}
      onDue={(d) => void wb.actions.edit(t.id, { due_date: d })}
    />
  );

  return (
    <div className="space-y-2">
      {empty && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ListChecks className="h-4 w-4 shrink-0" aria-hidden /> Este contacto no tiene tareas.
        </p>
      )}
      {open.length > 0 && <ul className="divide-y divide-border rounded-lg border border-border">{open.map(row)}</ul>}
      {done.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Completadas recientes ({done.length})</summary>
          <ul className="mt-1 divide-y divide-border rounded-lg border border-border">{done.map(row)}</ul>
        </details>
      )}
      {add}
      <Link href={`/dashboard/tareas`} className="block text-xs text-muted-foreground hover:text-foreground hover:underline">Ver todas las tareas</Link>
    </div>
  );
}

function Row({ task, today, canEdit, busy, ownerName, onOpen, onStatus, onDue }: { task: TaskRow; today: string; canEdit: boolean; busy: boolean; ownerName: string | null; onOpen: (el: HTMLElement) => void; onStatus: (s: TaskStatus) => void; onDue: (d: string | null) => void }) {
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
      <button type="button" onClick={(e) => onOpen(e.currentTarget)} className={cn("min-w-0 flex-1 truncate text-left hover:underline", task.status === "completed" && "text-muted-foreground line-through")}>{task.title}</button>
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
          className="h-7 w-[8.5rem] shrink-0 rounded-md border border-primary bg-background px-1 text-xs"
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
