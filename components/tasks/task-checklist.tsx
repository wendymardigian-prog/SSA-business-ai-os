"use client";

/**
 * El checklist de una tarea (Servicios A4, F153): «N de M», tildar, sumar y sacar puntos. No impide completar la
 * tarea. Lo guarda el servidor (`changeTaskChecklist`).
 */
import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { changeTaskChecklist } from "@/lib/actions/tasks";
import { checklistProgress, readChecklist, TASK_CHECKLIST_MAX, CHECKLIST_TEXT_MAX, type ChecklistItem } from "@/lib/tasks/checklist";
import { cn } from "@/lib/utils";

export function TaskChecklist({ taskId, initial, canEdit }: { taskId: string; initial: unknown; canEdit: boolean }) {
  const [list, setList] = useState<ChecklistItem[]>(() => readChecklist(initial));
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const progress = checklistProgress(list);
  if (list.length === 0 && !canEdit) return null;

  function apply(op: Parameters<typeof changeTaskChecklist>[1]) {
    setError(null);
    start(async () => {
      const res = await changeTaskChecklist(taskId, op);
      if (!res.ok) return setError(res.error);
      setList(res.data);
      if (op.type === "add") setText("");
    });
  }

  return (
    <section className="border-b border-border px-4 py-3" aria-label="Checklist">
      <p className="mb-2 text-xs font-semibold text-muted-foreground">Checklist{progress ? ` · ${progress.label}` : ""}</p>
      {list.length > 0 && (
        <ul className="space-y-1">
          {list.map((x) => (
            <li key={x.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={x.done}
                disabled={!canEdit || pending}
                onChange={(e) => apply({ type: "toggle", id: x.id, done: e.target.checked })}
                aria-label={x.text}
              />
              <span className={cn("min-w-0 flex-1 break-words", x.done && "text-muted-foreground line-through")}>{x.text}</span>
              {canEdit && (
                <button type="button" disabled={pending} onClick={() => apply({ type: "remove", id: x.id })} aria-label={`Sacar «${x.text}»`} className="rounded p-1 text-muted-foreground hover:bg-accent">
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && list.length < TASK_CHECKLIST_MAX && (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) apply({ type: "add", text });
          }}
        >
          <input aria-label="Nuevo punto" placeholder="Agregar un punto…" maxLength={CHECKLIST_TEXT_MAX} value={text} onChange={(e) => setText(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm" />
          <button type="submit" disabled={pending || !text.trim()} aria-label="Agregar el punto" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-accent disabled:opacity-50">
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-bad">
          {error}
        </p>
      )}
    </section>
  );
}
