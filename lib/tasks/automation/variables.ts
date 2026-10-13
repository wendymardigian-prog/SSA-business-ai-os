/**
 * Las variables `{{task.*}}` que los disparadores de Tareas le suman al flujo (Extra A, F25). PURAS.
 * Todo texto; lo que falta queda vacio.
 */

import { formatDay } from "../format";
import { PRIORITY_LABELS, STATUS_LABELS, type TaskPriority, type TaskStatus } from "../types";
import type { TaskEventPayload } from "./payload";

export interface TaskVariablesInput {
  payload: TaskEventPayload;
  ownerName: string;
  /** URL absoluta de la tarea, para avisos al equipo. */
  url: string;
}

export function taskVariables({ payload, ownerName, url }: TaskVariablesInput): Record<string, unknown> {
  return {
    task: {
      id: payload.task_id,
      title: payload.title,
      project: payload.project,
      status: STATUS_LABELS[payload.status as TaskStatus] ?? payload.status,
      priority: PRIORITY_LABELS[payload.priority as TaskPriority] ?? payload.priority,
      source: payload.source,
      due_date: payload.due_date ? formatDay(payload.due_date) : "",
      owner: ownerName,
      url,
    },
  };
}

/** Los campos que el editor ofrece para armar condiciones sobre una tarea (todos de texto). */
export const TASK_VARIABLE_FIELDS: Array<{ path: string; label: string }> = [
  { path: "task.title", label: "Título de la tarea" },
  { path: "task.project", label: "Proyecto" },
  { path: "task.status", label: "Estado" },
  { path: "task.priority", label: "Prioridad" },
  { path: "task.source", label: "Origen" },
  { path: "task.due_date", label: "Vencimiento" },
  { path: "task.owner", label: "Responsable" },
];

