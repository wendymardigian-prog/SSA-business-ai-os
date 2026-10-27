"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ListChecks, Plus } from "lucide-react";
import { tasksForContact } from "@/lib/tasks/contact-tasks";
import type { MemberLite } from "@/lib/tasks/table-model";
import type { TimeFormat } from "@/lib/calendar/time";
import type { TaskRow } from "@/lib/tasks/types";
import { TaskLine } from "./task-line";
import { TaskWorkbench, useOptionalTaskWorkbench, type TaskWorkbenchApi } from "./task-workbench";

/**
 * Las tareas de UN contacto, compartidas por la ficha y el panel de la bandeja (Tareas × CRM, R1 y R2).
 *
 * `ContactTasksProvider` pone un anfitrion de tareas (las tareas en pantalla, las acciones y el drawer) arriba de la
 * pagina o del panel; la seccion «Tareas» (`ContactTasks`) y la tarea de seguimiento que cuelga del campo «Proximo
 * seguimiento» leen del mismo, asi un cambio en una se ve en la otra al instante.
 */

export type ContactTasksStatus = "ready" | "loading" | "error" | "hidden";

export interface ContactTasksData {
  tasks: TaskRow[];
  members: MemberLite[];
  currentUserId: string;
  /** AAAA-MM-DD en la zona del workspace. */
  today: string;
  timeZone: string;
  /** 12 h / 24 h de quien mira (R6). */
  timeFormat?: TimeFormat;
  canEdit: boolean;
  canDelete: boolean;
}

interface ContactTasksCtx {
  contactId: string;
  contactName: string | null;
  status: ContactTasksStatus;
  onRetry?: () => void;
  wb: TaskWorkbenchApi;
}

const ContactTasksContext = createContext<Omit<ContactTasksCtx, "wb"> | null>(null);

const EMPTY: ContactTasksData = { tasks: [], members: [], currentUserId: "", today: "", timeZone: "UTC", canEdit: false, canDelete: false };

export function ContactTasksProvider({
  contactId,
  contactName = null,
  status,
  data,
  onRetry,
  children,
}: {
  contactId: string;
  contactName?: string | null;
  status: ContactTasksStatus;
  /** Obligatorio con `ready`. */
  data?: ContactTasksData;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const d = data ?? EMPTY;
  const value = useMemo(() => ({ contactId, contactName, status, onRetry }), [contactId, contactName, status, onRetry]);
  return (
    <TaskWorkbench
      initialTasks={d.tasks}
      members={d.members}
      currentUserId={d.currentUserId}
      today={d.today}
      timeZone={d.timeZone}
      timeFormat={d.timeFormat}
      canEdit={d.canEdit}
      canDelete={d.canDelete}
      contactNames={contactName ? { [contactId]: contactName } : undefined}
    >
      <ContactTasksContext.Provider value={value}>{children}</ContactTasksContext.Provider>
    </TaskWorkbench>
  );
}

/** Las tareas del contacto y el anfitrion, o null si no hay un `ContactTasksProvider` arriba. */
export function useContactTasks(): ContactTasksCtx | null {
  const ctx = useContext(ContactTasksContext);
  const wb = useOptionalTaskWorkbench();
  return ctx && wb ? { ...ctx, wb } : null;
}

/** La seccion «Tareas»: cargando, error con «Reintentar», vacio con «Agregar tarea», o la lista. */
export function ContactTasks({ wrap }: { wrap?: (children: ReactNode) => ReactNode } = {}) {
  const router = useRouter();
  const ct = useContactTasks();
  if (!ct || ct.status === "hidden") return null;
  const body = <Body ct={ct} onRetry={ct.onRetry ?? (() => router.refresh())} />;
  return <>{wrap ? wrap(body) : body}</>;
}

function Body({ ct, onRetry }: { ct: ContactTasksCtx; onRetry: () => void }) {
  const { wb, contactId } = ct;

  if (ct.status === "loading") {
    return (
      <div aria-busy="true" aria-label="Cargando tareas" className="space-y-2">
        <div className="h-9 animate-pulse rounded-lg bg-muted/50" />
        <div className="h-9 animate-pulse rounded-lg bg-muted/50" />
      </div>
    );
  }
  if (ct.status === "error") {
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
        <p>No pude cargar las tareas de este contacto.</p>
        <button type="button" onClick={onRetry} className="h-8 rounded-lg border border-red-500/40 px-3 text-xs hover:bg-red-500/10">Reintentar</button>
      </div>
    );
  }

  const { open, done } = tasksForContact(wb.tasks, contactId);
  const names = new Map(wb.members.map((m) => [m.id, m.name]));
  const empty = open.length === 0 && done.length === 0;
  const line = (t: TaskRow) => <TaskLine key={t.id} task={t} wb={wb} ownerName={t.owner_id ? (names.get(t.owner_id) ?? null) : null} />;

  return (
    <div className="space-y-2">
      {empty && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ListChecks className="h-4 w-4 shrink-0" aria-hidden /> Este contacto no tiene tareas.
        </p>
      )}
      {open.length > 0 && <ul className="divide-y divide-border rounded-lg border border-border">{open.map(line)}</ul>}
      {done.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Completadas recientes ({done.length})</summary>
          <ul className="mt-1 divide-y divide-border rounded-lg border border-border">{done.map(line)}</ul>
        </details>
      )}
      {wb.canEdit && (
        <button
          type="button"
          onClick={() => wb.startCreate({ contact_id: contactId })}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar tarea
        </button>
      )}
      <Link href="/dashboard/tareas" className="block text-xs text-muted-foreground hover:text-foreground hover:underline">Ver todas las tareas</Link>
    </div>
  );
}
