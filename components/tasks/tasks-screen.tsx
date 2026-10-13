"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ListChecks, Plus } from "lucide-react";
import { ToastProvider } from "@/components/content/drawer/toast";
import { PageHeader } from "@/components/page-header";
import type { CellPatch } from "@/lib/tasks/cell-edit";
import type { CompletionPlan } from "@/lib/tasks/core";
import type { DraftDefaults } from "@/lib/tasks/draft";
import { withoutTaskParam, withTaskParam } from "@/lib/tasks/drawer-url";
import { applyFilters } from "@/lib/tasks/filters";
import { listProjects } from "@/lib/tasks/project";
import { buildRows, groupRows, nextSort, remainingToLoad, sortRows, visibleLimit, type MemberLite } from "@/lib/tasks/table-model";
import type { TaskRow } from "@/lib/tasks/types";
import { clearFilters, countActiveFilters, parseViewState, serializeViewState, type SortColumn, type TasksViewState } from "@/lib/tasks/view-state";
import { FiltersBar } from "./filters-bar";
import { ShiftDialog } from "./shift-dialog";
import type { CellEnv } from "./task-cells";
import { TaskDrawer } from "./task-drawer";
import { TasksTable } from "./tasks-table";
import { useTaskActions } from "./use-task-actions";

export interface TasksScreenProps {
  initialTasks: TaskRow[];
  members: MemberLite[];
  currentUserId: string;
  /** AAAA-MM-DD en la zona del workspace, calculado en el servidor. */
  today: string;
  timeZone: string;
  canEdit: boolean;
  canDelete: boolean;
  contactNames: Record<string, string>;
  flowNames: Record<string, string>;
  /** No se pudieron leer las tareas. */
  loadError: boolean;
}

export function TasksScreen(props: TasksScreenProps) {
  return (
    <ToastProvider>
      <TasksScreenInner {...props} />
    </ToastProvider>
  );
}

function TasksScreenInner({ initialTasks, members, currentUserId, today, timeZone, canEdit, canDelete, contactNames, flowNames, loadError }: TasksScreenProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseViewState(searchParams), [searchParams]);

  // Las tareas viven en pantalla (para cambiarlas al instante) y se vuelven a tomar del servidor cuando este las manda de nuevo.
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [seenInitial, setSeenInitial] = useState(initialTasks);
  if (initialTasks !== seenInitial) {
    setSeenInitial(initialTasks);
    setTasks(initialTasks);
  }

  const [plan, setPlan] = useState<CompletionPlan | null>(null);
  const [creating, setCreating] = useState<(DraftDefaults & { contact_id?: string | null; conversation_id?: string | null }) | null>(null);
  const [loadedMore, setLoadedMore] = useState(0);
  const [missingId, setMissingId] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const actions = useTaskActions({ tasks, setTasks, onPlan: setPlan });

  // ── La URL ────────────────────────────────────────────────────────────────
  const navigate = useCallback(
    (next: TasksViewState, mode: "replace" | "push" = "replace") => {
      const qs = serializeViewState(next).toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (mode === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname],
  );

  const change = useCallback((next: TasksViewState) => {
    setLoadedMore(0);
    navigate(next);
  }, [navigate]);

  // ── Lo que se ve ──────────────────────────────────────────────────────────
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const memberNames = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const projects = useMemo(() => listProjects(tasks), [tasks]);
  const filtered = useMemo(() => applyFilters(tasks, state, { meId: currentUserId, today, byId }), [tasks, state, currentUserId, today, byId]);
  const sorted = useMemo(() => sortRows(buildRows(filtered, members, { today, byId }), state.sort), [filtered, members, today, byId, state.sort]);
  const limit = visibleLimit(sorted.length, loadedMore);
  const groups = useMemo(() => groupRows(sorted.slice(0, limit), state.group), [sorted, limit, state.group]);

  const source = useMemo(() => ({ flowNames: new Map(Object.entries(flowNames)) }), [flowNames]);
  const env: CellEnv = useMemo(() => ({ members, memberNames, projects, today, canEdit, source }), [members, memberNames, projects, today, canEdit, source]);

  // ── El drawer ─────────────────────────────────────────────────────────────
  const openTask = state.task ? (byId.get(state.task) ?? null) : null;
  // Un id que no existe o no se ve: se avisa («No encontramos esta tarea») y se limpia el parametro de la URL.
  if (state.task && !byId.has(state.task) && missingId !== state.task) setMissingId(state.task);
  useEffect(() => {
    if (state.task && !byId.has(state.task)) window.history.replaceState(null, "", withoutTaskParam(searchParams.toString()));
  }, [state.task, byId, searchParams]);
  const notFound = missingId !== null;

  const openDrawer = useCallback(
    (taskId: string, origin: HTMLElement | null = null) => {
      returnFocus.current = origin;
      setCreating(null);
      setMissingId(null);
      window.history.pushState(null, "", withTaskParam(searchParams.toString(), taskId));
    },
    [searchParams],
  );

  const closeDrawer = useCallback(() => {
    setCreating(null);
    setMissingId(null);
    if (state.task) window.history.replaceState(null, "", withoutTaskParam(searchParams.toString()));
  }, [searchParams, state.task]);

  const startCreate = useCallback((defaults: DraftDefaults = {}) => {
    returnFocus.current = null;
    setCreating(defaults);
  }, []);

  // ── Acciones de la tabla ──────────────────────────────────────────────────
  const onEdit = useCallback((taskId: string, patch: CellPatch) => void actions.edit(taskId, patch), [actions]);
  const onQuickCreate = useCallback(
    async (title: string, project: string | null) => !!(await actions.create({ title, project })),
    [actions],
  );
  const onSort = useCallback((column: SortColumn) => change({ ...state, sort: nextSort(state.sort, column) }), [change, state]);

  const hasAny = tasks.length > 0;
  const filtersOn = countActiveFilters(state) > 0;
  const drawerOpen = creating !== null || notFound || !!state.task;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/tareas"
        right={
          canEdit ? (
            <button
              type="button"
              onClick={() => startCreate()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 sm:px-3"
              aria-label="Nueva tarea"
            >
              <Plus className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Nueva tarea</span>
            </button>
          ) : undefined
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {loadError ? (
          <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
            <p className="font-medium">No pudimos cargar las tareas.</p>
            <button type="button" onClick={() => window.location.reload()} className="mt-2 h-8 rounded-lg border border-red-500/40 px-3 hover:bg-red-500/10">Reintentar</button>
          </div>
        ) : !hasAny ? (
          <EmptyState canEdit={canEdit} onCreate={() => startCreate()} />
        ) : (
          <div className="space-y-3">
            <FiltersBar state={state} onChange={change} members={members} projects={projects} total={tasks.length} shown={sorted.length} />
            {sorted.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <p className="text-sm font-medium">No hay tareas con estos filtros.</p>
                {filtersOn && (
                  <button type="button" onClick={() => change(clearFilters(state))} className="mt-3 h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent">
                    Limpiar los filtros
                  </button>
                )}
              </div>
            ) : (
              <TasksTable
                groups={groups}
                env={env}
                sort={state.sort}
                onSort={onSort}
                onOpen={openDrawer}
                onEdit={onEdit}
                onQuickCreate={onQuickCreate}
                busy={actions.busy}
                remaining={remainingToLoad(sorted.length, loadedMore)}
                onLoadMore={() => setLoadedMore((n) => n + 1)}
                totalShown={limit}
              />
            )}
          </div>
        )}
      </div>

      {drawerOpen && (
        <TaskDrawer
          key={creating ? "nueva" : (state.task ?? "no-encontrada")}
          mode={creating ? "create" : "view"}
          task={creating ? null : openTask}
          allTasks={tasks}
          members={members}
          memberNames={memberNames}
          projects={projects}
          today={today}
          timeZone={timeZone}
          canEdit={canEdit}
          canDelete={canDelete}
          actions={actions}
          contactName={openTask?.contact_id ? (contactNames[openTask.contact_id] ?? null) : null}
          source={source}
          defaults={creating ?? undefined}
          currentUserId={currentUserId}
          historyNames={Object.fromEntries(memberNames)}
          onClose={closeDrawer}
          onOpenTask={(id) => openDrawer(id)}
          onCreated={(task) => {
            setCreating(null);
            openDrawer(task.id);
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
    </div>
  );
}

function EmptyState({ canEdit, onCreate }: { canEdit: boolean; onCreate: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center rounded-xl border border-dashed border-border p-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <ListChecks className="h-6 w-6" aria-hidden />
      </span>
      <h2 className="mt-4 text-base font-semibold">Todavía no hay tareas</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Acá van las cosas por hacer del equipo: con responsable, fecha y, si hace falta, proyecto y dependencias.
        {!canEdit && " Cuando alguien te asigne una, la vas a ver acá."}
      </p>
      {canEdit && (
        <button type="button" onClick={onCreate} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" aria-hidden /> Crear tu primera tarea
        </button>
      )}
    </div>
  );
}

