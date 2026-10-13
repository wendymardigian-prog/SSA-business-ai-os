"use client";

import { useState } from "react";
import { ListPlus, Loader2 } from "lucide-react";
import { ActionError } from "@/components/contacts/ui";
import { createFollowupTask } from "@/lib/actions/tasks";
import { findFollowupTask, followupDateOf } from "@/lib/tasks/followup";
import { TaskLine } from "./task-line";
import { useContactTasks } from "./contact-tasks";

/**
 * Lo que cuelga del campo «Proximo seguimiento» (Tareas × CRM, R2): si ya hay una tarea para esa fecha, la tarea (con
 * las mismas acciones que la seccion «Tareas»); si no, el boton «Crear tarea». Quitar o cambiar la fecha no toca ninguna
 * tarea: para la fecha nueva simplemente vuelve a aparecer el boton, y la anterior sigue en la seccion «Tareas».
 *
 * Sin un `ContactTasksProvider` arriba (o sin `tasks.view`) no dibuja nada: el campo queda como siempre.
 */
export function FollowupTask({ contactId, contactName, followupValue, canCreateTask }: { contactId: string; contactName?: string | null; followupValue: string | null; canCreateTask?: boolean }) {
  const ct = useContactTasks();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ct || ct.status !== "ready" || !followupValue) return null;
  const { wb } = ct;
  const date = followupDateOf(followupValue, wb.timeZone);
  if (!date) return null;
  const task = findFollowupTask(wb.tasks, contactId, date);
  const canCreate = canCreateTask ?? wb.canEdit;

  async function create() {
    if (pending || !date) return;
    setPending(true);
    setError(null);
    const res = await createFollowupTask(contactId, date);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    wb.addTask(res.data.task);
    wb.openTask(res.data.task.id);
  }

  if (task) {
    const names = new Map(wb.members.map((m) => [m.id, m.name]));
    return (
      <ul className="mt-2 divide-y divide-border rounded-lg border border-border" aria-label="Tarea de seguimiento">
        <TaskLine task={task} wb={wb} ownerName={task.owner_id ? (names.get(task.owner_id) ?? null) : null} />
      </ul>
    );
  }
  if (!canCreate) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => void create()}
        disabled={pending}
        aria-label={contactName ? `Crear tarea de seguimiento para ${contactName}` : undefined}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm hover:bg-accent disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ListPlus className="h-3.5 w-3.5" aria-hidden />}
        Crear tarea
      </button>
      {error && <div className="mt-2"><ActionError message={error} /></div>}
    </div>
  );
}
