/**
 * Edicion en celda de la tabla (Extra A, F11). PURO.
 *
 * El flujo es optimista: se aplica el cambio en pantalla, se llama a la accion, y si falla se vuelve al
 * valor anterior y se muestra el error. Aca estan las piezas sin React: aplicar, deshacer, validar
 * antes de molestar al servidor y decidir que hace cada tecla.
 */

import { BLOCKER_ERROR_MESSAGES } from "./dependencies";
import { cleanProjectName } from "./project";
import { isTimeOfDay, isValidDuration } from "@/lib/calendar/time";
import { TASK_LIMITS, type TaskPriority, type TaskRow, type TaskStatus } from "./types";

export const EDITABLE_COLUMNS = ["status", "title", "owner", "followers", "project", "due", "priority"] as const;
export type EditableColumn = (typeof EDITABLE_COLUMNS)[number];

/** Lo que una celda puede cambiar. El proyecto viaja como texto (la clave la arma `cleanProjectName`). */
export interface CellPatch {
  title?: string;
  status?: TaskStatus;
  owner_id?: string | null;
  follower_ids?: string[];
  due_date?: string | null;
  /** Hora local del workspace (`HH:MM`); null la quita. Solo con fecha. */
  due_time?: string | null;
  /** 5 a 1440 minutos; null la quita. */
  duration_minutes?: number | null;
  priority?: TaskPriority;
  project?: string | null;
  /** Los dos de abajo solo se editan desde el drawer. */
  description?: string | null;
  start_date?: string | null;
  /** El orden dentro de una columna del tablero. */
  position?: number;
}

/** Aplica un cambio en pantalla. Devuelve la lista nueva y la fila ANTERIOR, para poder deshacer. */
export function applyOptimistic(
  tasks: readonly TaskRow[],
  taskId: string,
  patch: CellPatch,
): { next: TaskRow[]; previous: TaskRow | null } {
  const index = tasks.findIndex((t) => t.id === taskId);
  if (index === -1) return { next: [...tasks], previous: null };
  const previous = tasks[index];
  const row: TaskRow = { ...previous };

  if (patch.title !== undefined) row.title = patch.title.trim();
  if (patch.status !== undefined) {
    row.status = patch.status;
    if (patch.status !== "completed") row.completed_at = null;
  }
  if (patch.priority !== undefined) row.priority = patch.priority;
  if (patch.due_date !== undefined) row.due_date = patch.due_date;
  if (patch.due_time !== undefined) row.due_time = patch.due_time;
  if (patch.duration_minutes !== undefined) row.duration_minutes = patch.duration_minutes;
  // Sin fecha no hay hora ni duracion (como en la base).
  if (!row.due_date) {
    row.due_time = null;
    row.duration_minutes = null;
  }
  if (patch.start_date !== undefined) row.start_date = patch.start_date;
  if (patch.position !== undefined) row.position = patch.position;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.owner_id !== undefined) row.owner_id = patch.owner_id;
  if (patch.follower_ids !== undefined) row.follower_ids = [...patch.follower_ids];
  if (patch.project !== undefined) {
    const cleaned = cleanProjectName(patch.project);
    if (cleaned.ok) {
      row.project = cleaned.project;
      row.project_key = cleaned.key;
    }
  }
  // El responsable no es tambien seguidor.
  if (row.owner_id) row.follower_ids = row.follower_ids.filter((id) => id !== row.owner_id);

  const next = [...tasks];
  next[index] = row;
  return { next, previous };
}

/** Vuelve una fila a como estaba (despues de un fallo). Si la fila ya no esta, no hace nada. */
export function rollback(tasks: readonly TaskRow[], previous: TaskRow): TaskRow[] {
  return tasks.map((t) => (t.id === previous.id ? previous : t));
}

/** Reemplaza una fila con la que devolvio el servidor. Si es nueva, la agrega al final. */
export function upsertRow(tasks: readonly TaskRow[], row: TaskRow): TaskRow[] {
  return tasks.some((t) => t.id === row.id) ? tasks.map((t) => (t.id === row.id ? row : t)) : [...tasks, row];
}

/**
 * Lo que se puede decir antes de molestar al servidor. null = va. El servidor repite todo esto: esto solo
 * ahorra el viaje y da el mensaje al instante.
 */
export function validateCellChange(task: TaskRow, patch: CellPatch, byId: ReadonlyMap<string, TaskRow>): string | null {
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (t.length === 0) return "El título no puede estar vacío.";
    if (t.length > TASK_LIMITS.title) return `El título no puede pasar de ${TASK_LIMITS.title} caracteres.`;
  }
  if (patch.project !== undefined) {
    const cleaned = cleanProjectName(patch.project);
    if (!cleaned.ok) return cleaned.error;
  }
  if (patch.description && patch.description.length > TASK_LIMITS.description) {
    return `La descripción no puede pasar de ${TASK_LIMITS.description} caracteres.`;
  }
  const due = patch.due_date !== undefined ? patch.due_date : task.due_date;
  const start = patch.start_date !== undefined ? patch.start_date : task.start_date;
  if (start && due && start > due) {
    return patch.due_date !== undefined
      ? "El vencimiento no puede ser anterior a la fecha de inicio."
      : "La fecha de inicio no puede ser posterior al vencimiento.";
  }
  if (patch.due_date) {
    for (const b of task.blocked_by) {
      const blocker = byId.get(b.task_id);
      if (blocker?.due_date && patch.due_date < blocker.due_date) return BLOCKER_ERROR_MESSAGES.date_before_blocker;
    }
  }
  const time = patch.due_time !== undefined ? patch.due_time : task.due_time;
  if (patch.due_time && !isTimeOfDay(patch.due_time)) return "La hora no es válida.";
  if (time && !due) return "La hora necesita una fecha de vencimiento.";
  if (patch.duration_minutes !== undefined && patch.duration_minutes !== null && !isValidDuration(patch.duration_minutes)) {
    return "La duración tiene que ser de 5 a 1440 minutos.";
  }
  if (patch.follower_ids && patch.follower_ids.length > TASK_LIMITS.followers) {
    return `Una tarea puede tener como máximo ${TASK_LIMITS.followers} seguidores.`;
  }
  return null;
}

// ── Teclado ─────────────────────────────────────────────────────────────────

export type CellKeyAction = "commit" | "cancel" | "commit-next" | "commit-prev" | "open" | "none";

/**
 * Que hace cada tecla. Editando: Enter confirma, Esc cancela, Tab confirma y pasa a la celda siguiente.
 * Sin editar (el foco esta en la celda): Enter abre el editor.
 */
export function cellKeyAction(input: { key: string; shiftKey?: boolean; editing: boolean; multiline?: boolean; ctrlKey?: boolean }): CellKeyAction {
  const { key, shiftKey, editing, multiline, ctrlKey } = input;
  if (!editing) return key === "Enter" || key === "F2" ? "open" : "none";
  if (key === "Escape") return "cancel";
  if (key === "Enter") return multiline && !ctrlKey ? "none" : "commit";
  if (key === "Tab") return shiftKey ? "commit-prev" : "commit-next";
  return "none";
}

export interface CellPosition {
  row: number;
  col: number;
}

/**
 * La celda siguiente (o anterior) al tabular: recorre las columnas de la fila y salta a la siguiente fila.
 * Devuelve null al salirse de la tabla.
 */
export function neighborCell(pos: CellPosition, dir: 1 | -1, rowCount: number, colCount: number = EDITABLE_COLUMNS.length): CellPosition | null {
  let { row, col } = pos;
  col += dir;
  if (col >= colCount) {
    col = 0;
    row += 1;
  } else if (col < 0) {
    col = colCount - 1;
    row -= 1;
  }
  if (row < 0 || row >= rowCount) return null;
  return { row, col };
}
