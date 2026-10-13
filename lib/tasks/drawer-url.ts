/**
 * El drawer de una tarea vive en la URL: `?task=<id>` (Extra A, F12). Mismo patron que
 * `lib/content/drawer-url.ts`, pero con su propia base y SIN tocar los demas parametros (filtros,
 * orden, vista).
 */

export const TASKS_BASE = "/dashboard/tareas";

const ID_SHAPE = /^[0-9a-f][0-9a-f-]{7,63}$/i;

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

/** El id de `?task=`, o null si falta o no tiene forma de id. */
export function parseTaskParam(params: Params): string | null {
  const raw = params instanceof URLSearchParams ? params.get("task") : params.task;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && ID_SHAPE.test(value) ? value : null;
}

function toSearch(current: URLSearchParams | string): URLSearchParams {
  return new URLSearchParams(typeof current === "string" ? current : current.toString());
}

function href(search: URLSearchParams): string {
  const qs = search.toString();
  return qs ? `${TASKS_BASE}?${qs}` : TASKS_BASE;
}

/** La misma URL con esta tarea abierta. Conserva todo lo demas. */
export function withTaskParam(current: URLSearchParams | string, taskId: string): string {
  const next = toSearch(current);
  next.set("task", taskId);
  return href(next);
}

/** La misma URL con el drawer cerrado. Conserva todo lo demas. */
export function withoutTaskParam(current: URLSearchParams | string): string {
  const next = toSearch(current);
  next.delete("task");
  return href(next);
}
