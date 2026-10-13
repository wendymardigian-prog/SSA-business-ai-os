/**
 * El modelo del tablero de Tareas (Extra A, F16). PURO.
 *
 * Tres columnas por estado. Dentro de cada una las tarjetas se ordenan por `position` (un numero con
 * decimales: insertar entre dos tarjetas es el promedio, sin renumerar todo) y, si empatan, por antiguedad.
 */

import { TASK_STATUSES, type TaskRow, type TaskStatus } from "./types";

export type KanbanColumns = Record<TaskStatus, TaskRow[]>;

/** La separacion que se deja entre tarjetas al renumerar o insertar en un extremo. */
export const POSITION_STEP = 1000;

function byPosition(a: TaskRow, b: TaskRow): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Las tareas (ya filtradas) repartidas por estado y ordenadas por posicion. */
export function groupByStatus(tasks: readonly TaskRow[]): KanbanColumns {
  const columns: KanbanColumns = { pending: [], in_progress: [], completed: [] };
  for (const t of tasks) columns[t.status].push(t);
  for (const s of TASK_STATUSES) columns[s].sort(byPosition);
  return columns;
}

/**
 * La posicion de una tarjeta que va entre `prev` y `next` (null = no hay vecina de ese lado).
 * Columna vacia: 1000. Al inicio: 1000 antes de la primera. Al final: 1000 despues de la ultima. En el medio: el promedio.
 */
export function computePosition(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return POSITION_STEP;
  if (prev === null) return (next as number) - POSITION_STEP;
  if (next === null) return prev + POSITION_STEP;
  return (prev + next) / 2;
}

export interface MovePlan {
  /** El estado destino. */
  status: TaskStatus;
  /** ¿Cambia de columna? Si es asi, la tarjeta movida tambien cambia de estado. */
  changesStatus: boolean;
  /** Las posiciones a guardar: la de la tarjeta movida y, si hizo falta renumerar, las de su columna. */
  updates: Array<{ id: string; position: number }>;
}

/**
 * Que hay que guardar al soltar una tarjeta en `toIndex` de la columna `toStatus` (el indice cuenta SIN la tarjeta
 * movida). Si queda entre dos vecinas con posiciones distintas, solo cambia la suya; si las vecinas empatan (o ya no
 * hay espacio entre ellas), se renumera la columna de destino. Devuelve null si no cambia nada.
 */
export function planMove(columns: KanbanColumns, taskId: string, toStatus: TaskStatus, toIndex: number): MovePlan | null {
  const from = TASK_STATUSES.find((s) => columns[s].some((t) => t.id === taskId));
  if (!from) return null;
  const moved = columns[from].find((t) => t.id === taskId) as TaskRow;
  const column = columns[toStatus].filter((t) => t.id !== taskId);
  const index = Math.max(0, Math.min(toIndex, column.length));

  if (from === toStatus && columns[from].findIndex((t) => t.id === taskId) === index) return null;

  const prev = index > 0 ? column[index - 1] : null;
  const next = index < column.length ? column[index] : null;
  const position = computePosition(prev?.position ?? null, next?.position ?? null);

  const fits = (prev === null || position > prev.position) && (next === null || position < next.position);
  if (fits) return { status: toStatus, changesStatus: from !== toStatus, updates: [{ id: moved.id, position }] };

  // Sin espacio: la columna de destino queda numerada de 1000 en 1000 con la tarjeta en su lugar.
  const ordered = [...column.slice(0, index), moved, ...column.slice(index)];
  const updates = ordered
    .map((t, i) => ({ id: t.id, position: (i + 1) * POSITION_STEP, was: t.position }))
    .filter((u) => u.id === moved.id || u.position !== u.was)
    .map(({ id, position: p }) => ({ id, position: p }));
  return { status: toStatus, changesStatus: from !== toStatus, updates };
}

/** Donde cae una tarjeta soltada a la altura `y`, dado el centro vertical de cada tarjeta de la columna (en orden). */
export function dropIndex(centers: readonly number[], y: number): number {
  let i = 0;
  while (i < centers.length && y > centers[i]) i += 1;
  return i;
}
