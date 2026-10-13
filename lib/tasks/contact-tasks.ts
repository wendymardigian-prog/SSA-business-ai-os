/**
 * Las tareas de un contacto, para su ficha y para el panel de la bandeja (Tareas × CRM, R1). PURO.
 *
 * Primero las abiertas, por vencimiento (las sin fecha al final); despues las ultimas completadas. Se calcula en cada
 * render sobre las tareas que estan en pantalla, asi una tarea creada o editada en el momento cae en su lugar sin
 * esperar al servidor.
 */

import type { TaskRow } from "./types";

/** Cuantas completadas recientes se muestran. */
export const RECENT_COMPLETED = 5;

/** Por vencimiento (sin fecha al final), con la hora si la hay (las sin hora despues), y por creacion si empatan. */
function byDue(a: TaskRow, b: TaskRow): number {
  if (a.due_date !== b.due_date) {
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  const at = (a as { due_time?: string | null }).due_time ?? null;
  const bt = (b as { due_time?: string | null }).due_time ?? null;
  if (at !== bt) {
    if (at === null) return 1;
    if (bt === null) return -1;
    return at < bt ? -1 : 1;
  }
  if (a.created_at === b.created_at) return a.id < b.id ? -1 : 1;
  return a.created_at < b.created_at ? -1 : 1;
}

/** Las completadas, la que se completo hace menos primero. */
function byCompletedDesc(a: TaskRow, b: TaskRow): number {
  const av = a.completed_at ?? a.updated_at;
  const bv = b.completed_at ?? b.updated_at;
  if (av === bv) return a.id < b.id ? -1 : 1;
  return bv < av ? -1 : 1;
}

/** Separa abiertas y completadas, cada grupo en su orden. Sin tope: el tope lo pone `tasksForContact`. */
export function splitOpenDone(tasks: readonly TaskRow[]): { open: TaskRow[]; done: TaskRow[] } {
  return {
    open: tasks.filter((t) => t.status !== "completed").sort(byDue),
    done: tasks.filter((t) => t.status === "completed").sort(byCompletedDesc),
  };
}

/** Las tareas de ese contacto (sin las borradas): todas las abiertas y las ultimas `RECENT_COMPLETED` completadas. */
export function tasksForContact(tasks: readonly TaskRow[], contactId: string): { open: TaskRow[]; done: TaskRow[] } {
  const mine = tasks.filter((t) => t.contact_id === contactId && !t.deleted_at);
  const { open, done } = splitOpenDone(mine);
  return { open, done: done.slice(0, RECENT_COMPLETED) };
}
