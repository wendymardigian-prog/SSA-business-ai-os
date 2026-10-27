"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ToastProvider } from "@/components/content/drawer/toast";
import { loadTaskContext } from "@/lib/actions/tasks";
import type { CompletionPlan } from "@/lib/tasks/core";
import type { DraftDefaults } from "@/lib/tasks/draft";
import { parseTaskParam, withoutTaskParam, withTaskParam } from "@/lib/tasks/drawer-url";
import { listProjects } from "@/lib/tasks/project";
import type { MemberLite } from "@/lib/tasks/table-model";
import { upsertRow } from "@/lib/tasks/cell-edit";
import type { TaskRow } from "@/lib/tasks/types";
import type { TimeFormat } from "@/lib/calendar/time";
import { ShiftDialog } from "./shift-dialog";
import { TimeFormatProvider } from "./time-format-context";
import { TaskDrawer } from "./task-drawer";
import { useTaskActions, type TaskActions } from "./use-task-actions";

/**
 * El drawer de una tarea FUERA de la pantalla de Tareas (Tareas × CRM, R1): la ficha del contacto, el panel de la bandeja
 * y el calendario de Agenda lo comparten. Se ocupa de lo que la pantalla de Tareas hace por su cuenta: tener las tareas en
 * pantalla, las acciones (con el dialogo de mover fechas) y el drawer. Quien lo usa dibuja su lista y llama a `openTask`
 * o `startCreate`.
 *
 * Las dependencias, los proyectos y los nombres que el drawer necesita se piden recien cuando se abre uno (`loadTaskContext`),
 * con la sesion de la persona: la RLS decide que ve.
 */

export type CreateDefaults = DraftDefaults & { contact_id?: string | null; conversation_id?: string | null };

export interface TaskWorkbenchApi {
  tasks: TaskRow[];
  actions: TaskActions;
  members: MemberLite[];
  currentUserId: string;
  /** AAAA-MM-DD en la zona del workspace. */
  today: string;
  /** La zona del workspace: las fechas de las tareas son de esa zona. */
  timeZone: string;
  canEdit: boolean;
  openTask: (id: string, origin?: HTMLElement | null) => void;
  startCreate: (defaults?: CreateDefaults) => void;
  /** Suma (o reemplaza) una tarea que se creo por fuera de las acciones del anfitrion. */
  addTask: (task: TaskRow) => void;
}

const WorkbenchContext = createContext<TaskWorkbenchApi | null>(null);

/** El anfitrión más cercano, o null si no hay ninguno (los componentes que lo usan de forma opcional no cambian sin él). */
export function useOptionalTaskWorkbench(): TaskWorkbenchApi | null {
  return useContext(WorkbenchContext);
}

export function useTaskWorkbench(): TaskWorkbenchApi {
  const api = useContext(WorkbenchContext);
  if (!api) throw new Error("useTaskWorkbench: falta el <TaskWorkbench> arriba en el arbol.");
  return api;
}

export interface TaskWorkbenchProps {
  initialTasks: TaskRow[];
  members: MemberLite[];
  currentUserId: string;
  /** AAAA-MM-DD en la zona del workspace, calculado en el servidor. */
  today: string;
  timeZone: string;
  /** 12 h / 24 h de quien mira (R6). Sin esto, 24 h. */
  timeFormat?: TimeFormat;
  canEdit: boolean;
  canDelete: boolean;
  contactNames?: Record<string, string>;
  flowNames?: Record<string, string>;
  /** La tarea abierta vive en `?task=` de la URL (como en Tareas). Sin esto, el drawer se maneja en pantalla. */
  syncUrl?: boolean;
  children: ReactNode;
}

export function TaskWorkbench(props: TaskWorkbenchProps) {
  return (
    <ToastProvider>
      <WorkbenchInner {...props} />
    </ToastProvider>
  );
}

function WorkbenchInner({ initialTasks, members, currentUserId, today, timeZone, timeFormat = "24h", canEdit, canDelete, contactNames, flowNames, syncUrl = false, children }: TaskWorkbenchProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Las tareas viven en pantalla (para cambiarlas al instante) y se vuelven a tomar del servidor cuando este las manda de nuevo.
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [seenInitial, setSeenInitial] = useState(initialTasks);
  if (initialTasks !== seenInitial) {
    setSeenInitial(initialTasks);
    setTasks(initialTasks);
  }

  const [plan, setPlan] = useState<CompletionPlan | null>(null);
  const [creating, setCreating] = useState<CreateDefaults | null>(null);
  const [localOpen, setLocalOpen] = useState<string | null>(null);
  // El elemento al que vuelve el foco al cerrar el drawer.
  const [focusOrigin, setFocusOrigin] = useState<HTMLElement | null>(null);
  const returnFocus = useMemo(() => ({ current: focusOrigin }), [focusOrigin]);

  const actions = useTaskActions({ tasks, setTasks, onPlan: setPlan });

  // ── Cual esta abierta ─────────────────────────────────────────────────────
  const urlTask = syncUrl ? parseTaskParam(searchParams) : null;
  const openId = syncUrl ? urlTask : localOpen;

  // ── El contexto del drawer: todas las tareas que la persona ve + nombres ───
  const needContext = openId !== null || creating !== null;
  const contextRequested = useRef(false);
  const [context, setContext] = useState<{ done: boolean; extra: TaskRow[]; contactNames: Record<string, string>; flowNames: Record<string, string> }>({ done: false, extra: [], contactNames: {}, flowNames: {} });
  useEffect(() => {
    if (!needContext || contextRequested.current) return;
    contextRequested.current = true;
    void loadTaskContext().then((res) => {
      if (res.ok) setContext({ done: true, extra: res.data.tasks, contactNames: res.data.contactNames, flowNames: res.data.flowNames });
      else setContext((c) => ({ ...c, done: true }));
    });
  }, [needContext]);

  const ownIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);
  const allTasks = useMemo(() => [...tasks, ...context.extra.filter((t) => !ownIds.has(t.id))], [tasks, context.extra, ownIds]);

  const openRow = openId ? (allTasks.find((t) => t.id === openId) ?? null) : null;
  // Una tarea que solo vino del contexto (una dependencia, o `?task=` de otra) tambien se edita: pasa a las de pantalla.
  if (openRow && !ownIds.has(openRow.id)) setTasks((prev) => [...prev, openRow]);

  const names = useMemo(() => ({ ...(contactNames ?? {}), ...context.contactNames }), [contactNames, context.contactNames]);
  const source = useMemo(() => ({ flowNames: new Map(Object.entries({ ...(flowNames ?? {}), ...context.flowNames })) }), [flowNames, context.flowNames]);
  const memberNames = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const projects = useMemo(() => listProjects(allTasks), [allTasks]);

  const openTask = useCallback(
    (id: string, origin: HTMLElement | null = null) => {
      setFocusOrigin(origin);
      setCreating(null);
      if (syncUrl) window.history.pushState(null, "", withTaskParam(searchParams.toString(), id, pathname));
      else setLocalOpen(id);
    },
    [pathname, searchParams, syncUrl],
  );

  const closeDrawer = useCallback(() => {
    setCreating(null);
    if (syncUrl) {
      if (urlTask) window.history.replaceState(null, "", withoutTaskParam(searchParams.toString(), pathname));
    } else setLocalOpen(null);
  }, [pathname, searchParams, syncUrl, urlTask]);

  const startCreate = useCallback(
    (defaults: CreateDefaults = {}) => {
      setFocusOrigin(null);
      setCreating(defaults);
    },
    [],
  );

  const notFound = openId !== null && !openRow && context.done;
  const showDrawer = creating !== null || openRow !== null || notFound;
  const contactIdForName = creating ? creating.contact_id : openRow?.contact_id;

  const addTask = useCallback((task: TaskRow) => setTasks((prev) => upsertRow(prev, task)), []);
  const api = useMemo<TaskWorkbenchApi>(
    () => ({ tasks, actions, members, currentUserId, today, timeZone, canEdit, openTask, startCreate, addTask }),
    [tasks, actions, members, currentUserId, today, timeZone, canEdit, openTask, startCreate, addTask],
  );

  return (
    <WorkbenchContext.Provider value={api}>
      <TimeFormatProvider value={timeFormat}>
      {children}

      {showDrawer && (
        <TaskDrawer
          key={creating ? "nueva" : (openId ?? "no-encontrada")}
          mode={creating ? "create" : "view"}
          task={creating ? null : openRow}
          allTasks={allTasks}
          members={members}
          memberNames={memberNames}
          projects={projects}
          today={today}
          timeZone={timeZone}
          canEdit={canEdit}
          canDelete={canDelete}
          actions={actions}
          contactName={contactIdForName ? (names[contactIdForName] ?? null) : null}
          source={source}
          defaults={creating ?? undefined}
          currentUserId={currentUserId}
          historyNames={Object.fromEntries(memberNames)}
          onClose={closeDrawer}
          onOpenTask={(id) => openTask(id)}
          onCreated={(task) => {
            setCreating(null);
            openTask(task.id);
          }}
          returnFocus={returnFocus}
        />
      )}

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
      </TimeFormatProvider>
    </WorkbenchContext.Provider>
  );
}
