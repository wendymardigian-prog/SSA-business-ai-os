/**
 * El vencimiento de una tarea: lo guardado y lo que ve cada persona. PURO.
 *
 * `tasks.due_date` + `tasks.due_time` estan definidos en la zona del WORKSPACE y eso no cambia: las reglas de fechas, el
 * barrido de vencimientos y las funciones SQL trabajan sobre lo guardado. Lo que cambia es lo que se MUESTRA y lo que se
 * ESCRIBE desde la pantalla, que van en la zona de quien mira:
 *  - Una tarea SIN hora es una fecha civil y no se convierte: «vence el martes» es martes para todos.
 *  - Una tarea CON hora es un instante: puede caer en otro dia para quien esta en otra zona.
 *
 * «Hoy», «Mañana», «Ayer» y «vencida» se calculan sobre lo que se ve, con el dia de quien mira, y siguen siendo por DIA.
 *
 * Una zona o un valor invalido nunca rompe la pantalla: se devuelve lo guardado sin convertir.
 */

import { datetimeInputToIso, isoToDatetimeInput } from "@/lib/dates";
import { normalizeTime } from "@/lib/calendar/time";
import { isDateOnly } from "./dates";

/** Lo que esta guardado: fecha y hora en la zona del workspace. */
export interface StoredDue {
  due_date: string | null;
  due_time?: string | null;
}

/** Lo que ve (y escribe) quien mira, en su zona. La hora siempre `HH:MM`. */
export interface ViewerDue {
  date: string | null;
  time: string | null;
}

export interface DueZones {
  workspaceTz: string;
  viewerTz: string;
}

/** La hora de pared de una zona pasada a otra, o null si la zona o el valor no sirven. */
function convert(date: string, time: string, fromTz: string, toTz: string): { date: string; time: string } | null {
  if (!isDateOnly(date)) return null;
  try {
    const iso = datetimeInputToIso(`${date}T${time}`, fromTz);
    if (!iso) return null;
    const [nextDate, nextTime] = isoToDatetimeInput(iso, toTz).split("T");
    return isDateOnly(nextDate) && normalizeTime(nextTime) ? { date: nextDate, time: nextTime } : null;
  } catch {
    return null; // Intl lanza RangeError con una zona que no existe.
  }
}

/** Lo guardado -> lo que ve quien mira. */
export function dueForViewer(task: StoredDue, workspaceTz: string, viewerTz: string): ViewerDue {
  const date = task.due_date || null;
  const time = date ? normalizeTime(task.due_time) : null;
  if (!date || !time || workspaceTz === viewerTz) return { date, time };
  return convert(date, time, workspaceTz, viewerTz) ?? { date, time };
}

/** Lo que eligio quien mira -> lo que se guarda. La inversa de `dueForViewer`. */
export function dueToStored(view: ViewerDue, workspaceTz: string, viewerTz: string): { due_date: string | null; due_time: string | null } {
  const date = view.date || null;
  const time = date ? normalizeTime(view.time) : null;
  if (!date || !time || workspaceTz === viewerTz) return { due_date: date, due_time: time };
  const stored = convert(date, time, viewerTz, workspaceTz);
  return stored ? { due_date: stored.date, due_time: stored.time } : { due_date: date, due_time: time };
}

/** Lo que se ve con estas zonas o, sin zonas, lo guardado (normalizado). */
export function dueSeen(task: StoredDue, zones?: DueZones): ViewerDue {
  return zones ? dueForViewer(task, zones.workspaceTz, zones.viewerTz) : dueForViewer(task, "UTC", "UTC");
}

/**
 * Lo que hay que mandar cuando quien mira elige otro dia y/o hora: SOLO lo que cambia respecto de lo guardado. Con la hora
 * convertida, cambiar el dia puede mover la fecha y la hora guardadas juntas, por eso nunca se manda solo el dia que se ve.
 */
export function dueEditPatch(task: StoredDue, next: ViewerDue, zones: DueZones): { due_date?: string | null; due_time?: string | null } {
  const stored = dueToStored(next, zones.workspaceTz, zones.viewerTz);
  const patch: { due_date?: string | null; due_time?: string | null } = {};
  if (stored.due_date !== (task.due_date || null)) patch.due_date = stored.due_date;
  if (stored.due_time !== normalizeTime(task.due_time)) patch.due_time = stored.due_time;
  return patch;
}

/** Cambiar solo el dia que se ve (los editores sin campo de hora): la hora que veia quien mira se conserva. */
export function dueDayPatch(task: StoredDue, viewerDate: string | null, zones: DueZones): { due_date?: string | null; due_time?: string | null } {
  return dueEditPatch(task, { date: viewerDate, time: viewerDate ? dueSeen(task, zones).time : null }, zones);
}

/**
 * El instante de una tarea con hora, en milisegundos, para ordenar; sin hora, null. Una zona invalida ordena como si fuera
 * UTC: dentro de un mismo workspace el orden es el mismo.
 */
export function dueInstantMs(task: StoredDue, workspaceTz: string = "UTC"): number | null {
  const date = task.due_date || null;
  const time = date ? normalizeTime(task.due_time) : null;
  if (!date || !time || !isDateOnly(date)) return null;
  try {
    const iso = datetimeInputToIso(`${date}T${time}`, workspaceTz);
    if (iso) return Date.parse(iso);
  } catch {
    // Zona invalida: abajo.
  }
  return Date.parse(`${date}T${time}:00Z`);
}
