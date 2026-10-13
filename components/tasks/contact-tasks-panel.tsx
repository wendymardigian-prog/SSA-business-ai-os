"use client";

import { useEffect, useState } from "react";
import { listContactTasks } from "@/lib/actions/tasks";
import type { ContactTasksPayload } from "@/lib/tasks/contact-section";
import { ContactTasks } from "./contact-tasks";

type State = { kind: "loading" } | { kind: "hidden" } | { kind: "error" } | { kind: "ready"; data: ContactTasksPayload };

/**
 * La seccion «Tareas» del panel de contacto de la bandeja (R1). El panel carga sus datos en el navegador, asi que esta
 * pide las tareas por una accion (con la sesion de la persona: la RLS decide cuales ve). Sin `tasks.view` no muestra
 * nada; un fallo se ve como error con «Reintentar», nunca como «sin tareas».
 */
export function ContactTasksPanel({ contactId, contactName, wrap }: { contactId: string; contactName?: string | null; wrap: (children: React.ReactNode) => React.ReactNode }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [seen, setSeen] = useState<{ contactId: string; attempt: number }>({ contactId, attempt });

  // Otro contacto u otro intento: vuelve a «cargando» (en el render, sin un efecto que cambie estado de golpe).
  if (seen.contactId !== contactId || seen.attempt !== attempt) {
    setSeen({ contactId, attempt });
    setState({ kind: "loading" });
  }

  useEffect(() => {
    let cancelled = false;
    void listContactTasks(contactId).then((res) => {
      if (cancelled) return;
      if (res.ok) setState({ kind: "ready", data: res.data });
      else setState({ kind: res.code === "forbidden" ? "hidden" : "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [contactId, attempt]);

  if (state.kind === "hidden") return null;
  return wrap(
    state.kind === "loading" ? (
      <div aria-busy="true" aria-label="Cargando tareas" className="space-y-2">
        <div className="h-9 animate-pulse rounded-lg bg-muted/50" />
        <div className="h-9 animate-pulse rounded-lg bg-muted/50" />
      </div>
    ) : state.kind === "error" ? (
      <div role="alert" className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
        <p>No pude cargar las tareas de este contacto.</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className="h-8 rounded-lg border border-red-500/40 px-3 text-xs hover:bg-red-500/10">Reintentar</button>
      </div>
    ) : (
      <ContactTasks
        key={`${contactId}:${attempt}`}
        contactId={contactId}
        contactName={contactName}
        initialTasks={state.data.tasks}
        members={state.data.members}
        currentUserId={state.data.currentUserId}
        today={state.data.today}
        timeZone={state.data.timeZone}
        canEdit={state.data.canEdit}
        canDelete={state.data.canDelete}
      />
    ),
  );
}
