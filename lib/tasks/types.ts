/**
 * Tipos del modulo de Tareas (Extra A). Puro: no sabe de Supabase ni de React.
 * La forma de la fila es la de la tabla `tasks` (00196).
 */

export const TASK_STATUSES = ["pending", "in_progress", "completed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_SOURCES = ["manual", "flow", "agent", "cx"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

/** Un bloqueante y los dias de distancia que tenia entre los dos vencimientos al vincularlos. */
export type TaskBlocker = {
  task_id: string;
  gap_days: number;
};

export type TaskRow = {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  /** AAAA-MM-DD */
  start_date: string | null;
  /** AAAA-MM-DD */
  due_date: string | null;
  completed_at: string | null;
  owner_id: string | null;
  follower_ids: string[];
  project: string | null;
  project_key: string | null;
  blocked_by: TaskBlocker[];
  contact_id: string | null;
  conversation_id: string | null;
  source: TaskSource;
  source_ref: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/** Limites del modulo (plano §15, decision 4). */
export const TASK_LIMITS = {
  title: 200,
  description: 5000,
  project: 80,
  followers: 20,
  blockers: 10,
} as const;

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Pendiente",
  in_progress: "En progreso",
  completed: "Completada",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

/** Orden de importancia: mayor numero, mas urgente. */
export const PRIORITY_RANK: Record<TaskPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };
