/**
 * Las tareas de un contacto, para su ficha y para el panel de la bandeja (Tareas × CRM, R1). PURO.
 *
 * Primero las abiertas, por vencimiento (las sin fecha al final); despues las ultimas completadas. Se calcula en cada
 * render sobre las tareas que estan en pantalla, asi una tarea creada o editada en el momento cae en su lugar sin
 * esperar al servidor.
 */

import { dueInstantMs, dueSeen, type DueZones } from "./due-view";
import type { TaskRow } from "./types";

/** Cuantas completadas recientes se muestran. */
export const RECENT_COMPLETED = 5;

/**
 * Por vencimiento en la zona de quien mira (sin fecha al final) y, a igual dia, por instante (las sin hora despues), y por
 * creacion si empatan. Se calcula una vez por tarea: convertir usa `Intl`, que no conviene repetir en cada comparacion.
 */
function sortByDue(tasks: readonly TaskRow[], zones?: DueZones): TaskRow[] {
  const keyed = tasks.map((task) => ({ task, date: dueSeen(task, zones).date, instant: dueInstantMs(task, zones?.workspaceTz) }));
  keyed.sort((x, y) => {
    if (x.date !== y.date) {
      if (x.date === null) return 1;
      if (y.date === null) return -1;
      return x.date < y.date ? -1 : 1;
    }
    if (x.instant !== y.instant) {
      if (x.instant === null) return 1;
      if (y.instant === null) return -1;
      return x.instant - y.instant;
    }
    const [a, b] = [x.task, y.task];
    if (a.created_at === b.created_at) return a.id < b.id ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
  return keyed.map((k) => k.task);
}

/** Las completadas, la que se completo hace menos primero. */
function byCompletedDesc(a: TaskRow, b: TaskRow): number {
  const av = a.completed_at ?? a.updated_at;
  const bv = b.completed_at ?? b.updated_at;
  if (av === bv) return a.id < b.id ? -1 : 1;
  return bv < av ? -1 : 1;
}

/** Separa abiertas y completadas, cada grupo en su orden. Sin tope: el tope lo pone `tasksForContact`. */
export function splitOpenDone(tasks: readonly TaskRow[], zones?: DueZones): { open: TaskRow[]; done: TaskRow[] } {
  return {
    open: sortByDue(tasks.filter((t) => t.status !== "completed"), zones),
    done: tasks.filter((t) => t.status === "completed").sort(byCompletedDesc),
  };
}

/** Las tareas de ese contacto (sin las borradas): todas las abiertas y las ultimas `RECENT_COMPLETED` completadas. */
export function tasksForContact(tasks: readonly TaskRow[], contactId: string, zones?: DueZones): { open: TaskRow[]; done: TaskRow[] } {
  const mine = tasks.filter((t) => t.contact_id === contactId && !t.deleted_at);
  const { open, done } = splitOpenDone(mine, zones);
  return { open, done: done.slice(0, RECENT_COMPLETED) };
}
