"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CheckCircle2, ListPlus, Loader2 } from "lucide-react";
import { createTask } from "@/lib/actions/tasks";
import { suggestedTitle } from "@/lib/tasks/suggest";
import { TASK_LIMITS } from "@/lib/tasks/types";
import { FloatingPanel } from "./floating";

/**
 * «Crear tarea» en la bandeja (F20): sobre la conversacion abierta, con el contacto y la conversacion ya vinculados y un
 * titulo sugerido («Dar seguimiento a <contacto>») que se puede editar. Es un panelito: no cambia nada mas de la bandeja.
 */
export function CreateTaskButton({ contactId, conversationId, contactName }: { contactId: string | null; conversationId: string; contactName: string | null }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  function toggle() {
    if (!open) {
      setTitle(suggestedTitle(contactName));
      setDue("");
      setState("idle");
      setError(null);
      setCreatedId(null);
    }
    setOpen((v) => !v);
  }

  async function submit() {
    if (!title.trim() || state === "saving") return;
    setState("saving");
    setError(null);
    const result = await createTask({ title, due_date: due || null, contact_id: contactId, conversation_id: conversationId });
    if (result.ok) {
      setCreatedId(result.data.id);
      setState("done");
    } else {
      setError(result.error);
      setState("idle");
    }
  }

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={toggle}
        title="Crear tarea"
        aria-label="Crear tarea sobre esta conversación"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ListPlus className="h-3.5 w-3.5" />
      </button>
      {open && (
        <FloatingPanel anchor={anchor} onClose={() => setOpen(false)} label="Crear tarea" width={300} className="p-3">
          {state === "done" ? (
            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden /> Tarea creada
              </p>
              <p className="text-muted-foreground">Quedó a tu cargo y vinculada a esta conversación.</p>
              <div className="flex gap-2">
                {createdId && <Link href={`/dashboard/tareas?task=${createdId}`} className="h-8 rounded-lg bg-primary px-3 text-xs font-medium leading-8 text-primary-foreground hover:opacity-90">Ver la tarea</Link>}
                <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-lg px-3 text-xs text-muted-foreground hover:text-foreground">Cerrar</button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              className="space-y-2.5"
            >
              <div>
                <label htmlFor="inbox-task-title" className="text-xs font-medium text-muted-foreground">Título</label>
                <input
                  id="inbox-task-title"
                  value={title}
                  maxLength={TASK_LIMITS.title}
                  onChange={(e) => setTitle(e.target.value)}
                  // Entra directo al titulo: es lo unico que hay que revisar.
                  autoFocus
                  className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="inbox-task-due" className="text-xs font-medium text-muted-foreground">Vencimiento (opcional)</label>
                <input id="inbox-task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-sm" />
              </div>
              {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
              <div className="flex items-center gap-2 pt-0.5">
                <button type="submit" disabled={!title.trim() || state === "saving"} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                  {state === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  Crear tarea
                </button>
                <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-lg px-3 text-xs text-muted-foreground hover:text-foreground">Cancelar</button>
              </div>
            </form>
          )}
        </FloatingPanel>
      )}
    </>
  );
}
