/**
 * Aplicar los filtros de la vista a una lista de tareas (Extra A, F14). PURO.
 * El estado viene de `view-state.ts`; "hoy" y "yo" los pasa quien llama.
 */

import { foldText } from "./text";
import { isBlocked, isOverdue } from "./table-model";
import { ME, NONE, type TasksViewState } from "./view-state";
import type { TaskRow } from "./types";

export interface FilterContext {
  meId: string;
  /** AAAA-MM-DD en la zona del workspace. */
  today: string;
  byId: ReadonlyMap<string, TaskRow>;
}

export function matchesFilters(task: TaskRow, state: TasksViewState, ctx: FilterContext): boolean {
  if (state.mine && (task.owner_id !== ctx.meId || task.status === "completed")) return false;

  if (state.status.length > 0 && !state.status.includes(task.status)) return false;

  if (state.owner.length > 0) {
    const ok = state.owner.some((o) => (o === NONE ? task.owner_id === null : task.owner_id === (o === ME ? ctx.meId : o)));
    if (!ok) return false;
  }

  if (state.follower.length > 0) {
    const ok = state.follower.some((f) => task.follower_ids.includes(f === ME ? ctx.meId : f));
    if (!ok) return false;
  }

  if (state.project.length > 0) {
    const ok = state.project.some((p) => (p === NONE ? task.project_key === null : task.project_key === p));
    if (!ok) return false;
  }

  if (state.priority.length > 0 && !state.priority.includes(task.priority)) return false;
  if (state.source.length > 0 && !state.source.includes(task.source)) return false;
  if (state.overdue && !isOverdue(task, ctx.today)) return false;
  if (state.blocked && !isBlocked(task, ctx.byId)) return false;

  if (state.q) {
    const needle = foldText(state.q);
    if (!foldText(task.title).includes(needle)) return false;
  }

  return true;
}

export function applyFilters(tasks: readonly TaskRow[], state: TasksViewState, ctx: FilterContext): TaskRow[] {
  return tasks.filter((t) => matchesFilters(t, state, ctx));
}
