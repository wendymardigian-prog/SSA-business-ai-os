"use client";

import { useEffect, useState, type ReactNode } from "react";
import { listContactTasks } from "@/lib/actions/tasks";
import type { ContactTasksPayload } from "@/lib/tasks/contact-section";
import { ContactTasksProvider, type ContactTasksStatus } from "./contact-tasks";

type State = { kind: "loading" } | { kind: "hidden" } | { kind: "error" } | { kind: "ready"; data: ContactTasksPayload };

/**
 * Carga las tareas de un contacto para el panel de la bandeja (R1), que arma sus datos en el navegador, y pone el
 * `ContactTasksProvider` arriba del panel: la seccion «Tareas» y el campo de seguimiento leen del mismo. Las tareas se
 * piden por una accion con la sesion de la persona (la RLS decide cuales ve). Sin `tasks.view` no se muestra nada; un
 * fallo es un error con «Reintentar», nunca «sin tareas».
 */
export function ContactTasksLoader({ contactId, contactName, children }: { contactId: string; contactName?: string | null; children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [seen, setSeen] = useState({ contactId, attempt });

  // Otro contacto u otro intento: vuelve a «cargando» (al renderizar, sin un efecto que cambie estado de golpe).
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

  const status: ContactTasksStatus = state.kind;
  return (
    <ContactTasksProvider
      key={contactId}
      contactId={contactId}
      contactName={contactName}
      status={status}
      data={state.kind === "ready" ? state.data : undefined}
      onRetry={() => setAttempt((n) => n + 1)}
    >
      {children}
    </ContactTasksProvider>
  );
}
