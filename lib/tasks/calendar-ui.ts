/**
 * Decisiones chicas de como se dibujan las tareas en el calendario (Tareas × CRM, R7). PURO: el componente solo las compone.
 */

import { foldText } from "./text";
import { formatTime, type TimeFormat } from "./time";
import type { TaskPriority, TaskRow } from "./types";

/** El punto de color de la prioridad (clase de Tailwind). */
export const PRIORITY_DOT: Record<TaskPriority, string> = {
  low: "bg-zinc-400",
  normal: "bg-slate-500",
  high: "bg-amber-500",
  urgent: "bg-red-500",
};

/** El color del estado: el borde izquierdo de la tarjeta. */
export const STATUS_BORDER: Record<TaskRow["status"], string> = {
  pending: "border-l-slate-400",
  in_progress: "border-l-blue-500",
  completed: "border-l-emerald-500",
};

/** Una tarea completada no se arrastra (ni se reabre arrastrando). */
export function isDraggableTask(task: Pick<TaskRow, "status">, canEdit: boolean): boolean {
  return canEdit && task.status !== "completed";
}

/** El texto de una tarea en una celda del mes: «09:30 Titulo» o «Sin hora · Titulo». */
export function monthChipText(task: Pick<TaskRow, "title" | "due_time">, timeFormat: TimeFormat): string {
  const time = formatTime(task.due_time, timeFormat);
  return time ? `${time} ${task.title}` : `Sin hora · ${task.title}`;
}

export const UNDATED_LIMIT = 50;

/** Las tareas abiertas sin fecha para el panel «Sin fecha»: sin las completadas ni las borradas, con buscador por titulo, hasta 50. */
export function undatedTasks(tasks: readonly TaskRow[], query: string): { rows: TaskRow[]; total: number } {
  const q = foldText(query.trim());
  const all = tasks
    .filter((t) => !t.due_date && t.status !== "completed" && !t.deleted_at)
    .filter((t) => !q || foldText(t.title).includes(q))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return { rows: all.slice(0, UNDATED_LIMIT), total: all.length };
}

/** El modo de tareas en la URL (`tareas=1` es «mias», `tareas=todas` todas las que veo, sin parametro apagado). */
export type TasksMode = "off" | "mine" | "all";

export function parseTasksMode(value: string | string[] | null | undefined, canView: boolean): TasksMode {
  if (!canView) return "off";
  const v = Array.isArray(value) ? value[0] : value;
  return v === "todas" ? "all" : v === "1" ? "mine" : "off";
}

export function tasksModeParam(mode: TasksMode): string | null {
  return mode === "mine" ? "1" : mode === "all" ? "todas" : null;
}
