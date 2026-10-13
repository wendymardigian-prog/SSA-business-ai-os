/**
 * Los eventos de automatizacion de Tareas (Extra A, F25): `task_completed` y `task_overdue`. PURO.
 *
 * El payload lleva SOLO escalares y NUNCA `booking_id` (el cron trata como «reserva» cualquier payload con `booking_id` y se
 * saltearia «no contactar»). La tarea se vuelve a leer de la base para las variables y los filtros finos.
 */

import type { TaskRow } from "../types";

export const TASK_EVENT_TYPES = ["task_completed", "task_overdue"] as const;
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export function isTaskEventType(value: unknown): value is TaskEventType {
  return typeof value === "string" && (TASK_EVENT_TYPES as readonly string[]).includes(value);
}

export interface TaskEventPayload {
  task_id: string;
  title: string;
  project: string;
  project_key: string;
  status: string;
  source: string;
  priority: string;
  due_date: string;
  /** Cuando se completo (solo `task_completed`). */
  completed_at: string;
}

type PayloadTask = Pick<TaskRow, "id" | "title" | "project" | "project_key" | "status" | "source" | "priority" | "due_date" | "completed_at">;

/** Solo escalares (texto vacio donde no hay dato, como el resto de los payloads). */
export function taskEventPayload(task: PayloadTask): TaskEventPayload {
  return {
    task_id: task.id,
    title: task.title,
    project: task.project ?? "",
    project_key: task.project_key ?? "",
    status: task.status,
    source: task.source,
    priority: task.priority,
    due_date: task.due_date ?? "",
    completed_at: task.completed_at ?? "",
  };
}

export function parseTaskPayload(payload: unknown): TaskEventPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.task_id !== "string" || !p.task_id) return null;
  const s = (key: string) => (typeof p[key] === "string" ? (p[key] as string) : "");
  return {
    task_id: p.task_id,
    title: s("title"),
    project: s("project"),
    project_key: s("project_key"),
    status: s("status"),
    source: s("source"),
    priority: s("priority"),
    due_date: s("due_date"),
    completed_at: s("completed_at"),
  };
}

/**
 * A quien le corresponde el evento cuando la tarea NO tiene contacto: su responsable, si no quien la creo, si no quien
 * hizo el cambio. Si no hay ninguna persona, el evento no se emite (el motor necesita un sujeto).
 */
export function eventSubjectPerson(task: Pick<TaskRow, "owner_id" | "created_by">, actorId?: string | null): string | null {
  return task.owner_id ?? task.created_by ?? actorId ?? null;
}

/** La clave de idempotencia: completar, reabrir y volver a completar dispara de nuevo; vencida, una vez por vencimiento. */
export function taskDedupeKey(type: string, payload: unknown, eventId: string): string {
  const p = parseTaskPayload(payload);
  if (!p) return `event:${eventId}`;
  if (type === "task_overdue") return `task:overdue:${p.task_id}:${p.due_date}`;
  return `task:completed:${p.task_id}:${p.completed_at || eventId}`;
}
