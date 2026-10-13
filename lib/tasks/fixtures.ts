import type { TaskRow } from "./types";

/** Una tarea de prueba con todos los campos. Solo para tests. */
export function makeTask(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    workspace_id: "ws-1",
    title: "Tarea",
    description: null,
    status: "pending",
    priority: "normal",
    start_date: null,
    due_date: null,
    due_time: null,
    duration_minutes: null,
    completed_at: null,
    owner_id: null,
    follower_ids: [],
    project: null,
    project_key: null,
    blocked_by: [],
    contact_id: null,
    conversation_id: null,
    source: "manual",
    source_ref: null,
    position: 0,
    created_by: null,
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:00.000Z",
    deleted_at: null,
    ...over,
  };
}

let counter = 0;
/** Ids distintos y con forma de uuid. */
export function taskId(n: number = ++counter): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
