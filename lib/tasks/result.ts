/** Resultado de toda accion de Tareas: nunca lanza al cliente (Extra A, F8). */

export type TaskErrorCode =
  | "validation"
  | "forbidden"
  | "stale"
  | "cycle"
  | "date_before_blocker"
  | "conflict"
  | "use_complete"
  | "server";

export type TaskActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: TaskErrorCode };

export const FORBIDDEN_MESSAGE = "No tenés permiso sobre esa tarea o ya no existe.";

export function fail(code: TaskErrorCode, error: string): { ok: false; error: string; code: TaskErrorCode } {
  return { ok: false, error, code };
}

export function success<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}
