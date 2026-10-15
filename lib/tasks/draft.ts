/**
 * Los valores del drawer (Extra A, F12). PURO.
 *
 * El drawer muestra y edita los mismos campos para una tarea que existe y para una que todavia no:
 * `TaskValues` es esa forma comun. Para una tarea que existe, cada cambio va al servidor; para una nueva,
 * se acumula en el borrador hasta apretar «Crear tarea».
 */

import type { CellPatch } from "./cell-edit";
import { cleanProjectName } from "./project";
import { normalizeTime } from "./time";
import type { TaskPriority, TaskRow, TaskStatus } from "./types";

export interface TaskValues {
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  duration_minutes: number | null;
  owner_id: string | null;
  follower_ids: string[];
  project: string | null;
  projectKey: string | null;
}

export function valuesFromTask(t: TaskRow): TaskValues {
  return {
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    start_date: t.start_date,
    due_date: t.due_date,
    due_time: normalizeTime(t.due_time),
    duration_minutes: t.duration_minutes,
    owner_id: t.owner_id,
    follower_ids: t.follower_ids,
    project: t.project,
    projectKey: t.project_key,
  };
}

/** Lo que se puede precargar al crear una tarea desde otro lugar (la ficha de un contacto, la bandeja). */
export interface DraftDefaults {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  start_date?: string | null;
  due_date?: string | null;
  owner_id?: string | null;
  follower_ids?: string[];
  project?: string | null;
}

/** El borrador de una tarea nueva: por defecto, el responsable es quien la crea. */
export function draftFromDefaults(defaults: DraftDefaults | undefined, currentUserId: string): TaskValues {
  const project = cleanProjectName(defaults?.project ?? null);
  const owner = defaults?.owner_id === undefined ? currentUserId : defaults.owner_id;
  return {
    title: defaults?.title ?? "",
    description: defaults?.description ?? null,
    status: "pending",
    priority: defaults?.priority ?? "normal",
    start_date: defaults?.start_date ?? null,
    due_date: defaults?.due_date ?? null,
    due_time: null,
    duration_minutes: null,
    owner_id: owner,
    follower_ids: (defaults?.follower_ids ?? []).filter((id) => id !== owner),
    project: project.ok ? project.project : null,
    projectKey: project.ok ? project.key : null,
  };
}

/** Aplica un cambio de un campo al borrador. El responsable no puede ser tambien seguidor. */
export function applyDraftPatch(values: TaskValues, patch: CellPatch): TaskValues {
  const next: TaskValues = { ...values };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.start_date !== undefined) next.start_date = patch.start_date;
  if (patch.due_date !== undefined) next.due_date = patch.due_date;
  if (patch.due_time !== undefined) next.due_time = patch.due_time;
  if (patch.duration_minutes !== undefined) next.duration_minutes = patch.duration_minutes;
  // Sin fecha no hay hora ni duracion.
  if (!next.due_date) {
    next.due_time = null;
    next.duration_minutes = null;
  }
  if (patch.owner_id !== undefined) next.owner_id = patch.owner_id;
  if (patch.follower_ids !== undefined) next.follower_ids = [...patch.follower_ids];
  if (patch.project !== undefined) {
    const cleaned = cleanProjectName(patch.project);
    if (cleaned.ok) {
      next.project = cleaned.project;
      next.projectKey = cleaned.key;
    }
  }
  if (next.owner_id) next.follower_ids = next.follower_ids.filter((id) => id !== next.owner_id);
  return next;
}

/** Se puede crear con un titulo y fechas en orden. */
export function draftProblem(values: TaskValues): string | null {
  if (!values.title.trim()) return "Escribí un título.";
  if (values.start_date && values.due_date && values.start_date > values.due_date) {
    return "La fecha de inicio no puede ser posterior al vencimiento.";
  }
  return null;
}

/**
 * El cambio que hace elegir una fecha en el drawer (que muestra UNA sola fecha: la de vencimiento). Si la tarea
 * ya traia una fecha de inicio y la nueva fecha cae antes, se quita el inicio: si no, la base rechazaria el
 * cambio por «inicio posterior al vencimiento» sin que el drawer tenga nada para corregirlo.
 */
export function dueDatePatch(values: Pick<TaskValues, "start_date">, due: string | null): CellPatch {
  if (due && values.start_date && values.start_date > due) return { due_date: due, start_date: null };
  return { due_date: due };
}
