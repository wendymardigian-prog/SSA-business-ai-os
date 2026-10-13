"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/content/drawer/toast";
import { completeTask, createTask, deleteTask, planCompletion, setTaskBlockers, updateTask } from "@/lib/actions/tasks";
import { applyOptimistic, rollback, upsertRow, validateCellChange, type CellPatch } from "@/lib/tasks/cell-edit";
import type { CompletionPlan } from "@/lib/tasks/core";
import { completionRoute } from "@/lib/tasks/shift-preview";
import type { TaskRow } from "@/lib/tasks/types";

/**
 * Todo lo que la pantalla de Tareas le pide al servidor, con el mismo patron en cada caso:
 * aplicar el cambio en pantalla, llamar a la accion y, si falla, volver al valor anterior con un
 * mensaje claro. La logica de cada paso (aplicar, deshacer, validar, decidir si hace falta el dialogo
 * de fechas) esta en `lib/tasks/*`; esto solo la conecta con React.
 */

export interface CreateInput {
  title: string;
  description?: string | null;
  priority?: TaskRow["priority"];
  status?: TaskRow["status"];
  start_date?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  duration_minutes?: number | null;
  owner_id?: string | null;
  follower_ids?: string[];
  project?: string | null;
  contact_id?: string | null;
  conversation_id?: string | null;
}

export function useTaskActions({
  tasks,
  setTasks,
  onPlan,
}: {
  tasks: TaskRow[];
  setTasks: Dispatch<SetStateAction<TaskRow[]>>;
  /** Hay corrimientos de fechas por confirmar: la pantalla abre el dialogo. */
  onPlan: (plan: CompletionPlan) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  // Siempre la ultima lista, sin volver a crear las funciones en cada render.
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  });

  const mark = useCallback((id: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const error = useCallback((text: string) => toast.push({ tone: "error", text }), [toast]);

  /**
   * Completa con el plan que la persona vio. Si algo cambio mientras decidia (`stale`) se vuelve a armar el plan UNA vez:
   * si ahora pide confirmacion, se reabre el dialogo; si no, se completa con ese plan.
   */
  const finishCompletion = useCallback(
    async (firstPlan: CompletionPlan, firstApply: boolean): Promise<boolean> => {
      let plan = firstPlan;
      let applyShifts = firstApply;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!tasksRef.current.some((t) => t.id === plan.taskId)) return false;
        const { next, previous } = applyOptimistic(tasksRef.current, plan.taskId, { status: "completed" });
        setTasks(next.map((t) => (t.id === plan.taskId ? { ...t, completed_at: new Date().toISOString() } : t)));
        mark(plan.taskId, true);
        const result = await completeTask(plan.taskId, applyShifts, plan.expected);
        mark(plan.taskId, false);

        if (result.ok) {
          const moved = result.data.shifted.length + result.data.hiddenShifted;
          toast.push({ tone: "ok", text: moved > 0 ? `Completaste «${plan.title}» y moviste ${moved === 1 ? "la fecha de 1 tarea" : `las fechas de ${moved} tareas`}.` : `Completaste «${plan.title}».` });
          // Las tareas que se movieron las trae el servidor.
          router.refresh();
          return true;
        }

        if (previous) setTasks((prev) => rollback(prev, previous));
        if (result.code !== "stale" || attempt === 1) {
          error(result.error);
          return false;
        }
        const fresh = await planCompletion(plan.taskId);
        if (!fresh.ok) {
          error(fresh.error);
          return false;
        }
        toast.push({ tone: "warning", text: "Algo cambió mientras decidías. Revisá las fechas nuevas." });
        if (completionRoute(fresh.data.shifts.length) === "dialog") {
          onPlan(fresh.data);
          return false;
        }
        plan = fresh.data;
        applyShifts = false;
      }
      return false;
    },
    [error, mark, onPlan, router, setTasks, toast],
  );

  /** «Completar»: si mueve fechas de otras tareas, se pregunta; si no, se completa directo. */
  const requestComplete = useCallback(
    async (taskId: string): Promise<void> => {
      mark(taskId, true);
      const plan = await planCompletion(taskId);
      mark(taskId, false);
      if (!plan.ok) return error(plan.error);
      if (completionRoute(plan.data.shifts.length) === "dialog") return onPlan(plan.data);
      await finishCompletion(plan.data, false);
    },
    [error, finishCompletion, mark, onPlan],
  );

  /** Un cambio de una celda o de un campo del drawer. Devuelve si se guardo. */
  const edit = useCallback(
    async (taskId: string, patch: CellPatch): Promise<boolean> => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return false;
      const byId = new Map(tasksRef.current.map((t) => [t.id, t]));
      const invalid = validateCellChange(task, patch, byId);
      if (invalid) {
        error(invalid);
        return false;
      }
      if (patch.status === "completed") {
        await requestComplete(taskId);
        return true;
      }
      const { next, previous } = applyOptimistic(tasksRef.current, taskId, patch);
      setTasks(next);
      mark(taskId, true);
      const result = await updateTask(taskId, patch);
      mark(taskId, false);
      if (!result.ok) {
        if (previous) setTasks((prev) => rollback(prev, previous));
        error(result.error);
        return false;
      }
      setTasks((prev) => upsertRow(prev, result.data.after));
      return true;
    },
    [error, mark, requestComplete, setTasks],
  );

  const create = useCallback(
    async (input: CreateInput): Promise<TaskRow | null> => {
      const result = await createTask(input);
      if (!result.ok) {
        error(result.error);
        return null;
      }
      setTasks((prev) => upsertRow(prev, result.data));
      return result.data;
    },
    [error, setTasks],
  );

  const remove = useCallback(
    async (taskId: string): Promise<boolean> => {
      mark(taskId, true);
      const result = await deleteTask(taskId);
      mark(taskId, false);
      if (!result.ok) {
        error(result.error);
        return false;
      }
      setTasks((prev) =>
        prev
          .filter((t) => t.id !== taskId)
          .map((t) => (t.blocked_by.some((b) => b.task_id === taskId) ? { ...t, blocked_by: t.blocked_by.filter((b) => b.task_id !== taskId) } : t)),
      );
      toast.push({ tone: "ok", text: "Borraste la tarea." });
      return true;
    },
    [error, mark, setTasks, toast],
  );

  const saveBlockers = useCallback(
    async (taskId: string, blockerIds: string[]): Promise<boolean> => {
      mark(taskId, true);
      const result = await setTaskBlockers(taskId, blockerIds);
      mark(taskId, false);
      if (!result.ok) {
        error(result.error);
        return false;
      }
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, blocked_by: result.data } : t)));
      return true;
    },
    [error, mark, setTasks],
  );

  return useMemo(
    () => ({ busy, edit, create, remove, saveBlockers, requestComplete, finishCompletion }),
    [busy, edit, create, remove, saveBlockers, requestComplete, finishCompletion],
  );
}

export type TaskActions = ReturnType<typeof useTaskActions>;
