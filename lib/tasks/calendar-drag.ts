/**
 * Arrastrar una tarea en el calendario de Agenda (Tareas × CRM, R7). PURO.
 *
 * Las tareas se mueven SIN confirmar (a diferencia de las agendas): el cambio se aplica al instante con las mismas
 * acciones y validaciones que la edicion en celda, y se puede deshacer. Aca esta la cuenta: de donde se solto a
 * fecha + hora + duracion, y como volver atras.
 */

import { dateInTz, minutesOfDayInTz, wallClockToUtc } from "@/lib/scheduling/time/tz";
import type { WallTime } from "@/lib/scheduling/types";
import { formatTaskWhen } from "./format";
import { minutesToTime, normalizeTime, type TimeFormat } from "@/lib/calendar/time";
import type { TaskRow } from "./types";

// La rejilla (pasos de 15 minutos) es del calendario, no de las tareas: la usan tambien las agendas.
export { SNAP_MINUTES, snapMinutes } from "@/lib/calendar/snap";

/** Donde se solto: una hora de la rejilla, la franja «Sin hora» de un dia, o una celda del mes. */
export type TaskDropTarget =
  | { kind: "slot"; date: string; minutes: number }
  | { kind: "allday"; date: string }
  | { kind: "day"; date: string };

/** Lo que cambia en la tarea: fecha, hora (HH:MM o null) y duracion (o null). */
export interface TaskDropPatch {
  due_date: string;
  due_time: string | null;
  duration_minutes: number | null;
}

type Timed = Pick<TaskRow, "due_date" | "due_time" | "duration_minutes">;

/**
 * A donde va la tarea. Las fechas y horas de la tarea son del workspace; el destino es del calendario (zona de quien mira).
 *  - Hora de la rejilla: fecha + hora, y conserva la duracion.
 *  - Franja «Sin hora»: solo fecha (se quita la hora y la duracion).
 *  - Celda del mes: cambia el dia y conserva la hora (la que veia quien mira) y la duracion.
 */
export function dropTarget(args: { task: Timed; target: TaskDropTarget; workspaceTz: string; viewerTz: string }): TaskDropPatch {
  const { task, target, workspaceTz, viewerTz } = args;
  const toWorkspace = (date: string, minutes: number) => {
    const instant = wallClockToUtc(date, minutesToTime(minutes) as WallTime, viewerTz);
    return { date: dateInTz(instant, workspaceTz), time: minutesToTime(minutesOfDayInTz(instant, workspaceTz)) };
  };

  if (target.kind === "allday") return { due_date: target.date, due_time: null, duration_minutes: null };

  if (target.kind === "slot") {
    const at = toWorkspace(target.date, target.minutes);
    return { due_date: at.date, due_time: at.time, duration_minutes: task.duration_minutes ?? null };
  }

  // Celda del mes. Sin hora, solo cambia el dia.
  const time = normalizeTime(task.due_time);
  if (!time || !task.due_date) return { due_date: target.date, due_time: null, duration_minutes: null };
  const current = wallClockToUtc(task.due_date, time as WallTime, workspaceTz);
  const at = toWorkspace(target.date, minutesOfDayInTz(current, viewerTz));
  return { due_date: at.date, due_time: at.time, duration_minutes: task.duration_minutes ?? null };
}

/** Soltar en el mismo lugar no hace nada. */
export function isSameDrop(task: Timed, patch: TaskDropPatch): boolean {
  return task.due_date === patch.due_date && normalizeTime(task.due_time) === patch.due_time && (task.duration_minutes ?? null) === patch.duration_minutes;
}

/** Restaura fecha, hora y duracion anteriores. */
export function undoPatch(before: Timed): TaskDropPatch {
  return { due_date: before.due_date as string, due_time: normalizeTime(before.due_time), duration_minutes: before.duration_minutes ?? null };
}

/** «Tarea movida al 20/10 · 14:30» (o solo la fecha si no tiene hora). */
export function movedMessage(patch: TaskDropPatch, timeFormat: TimeFormat, today: string): string {
  return `Tarea movida al ${formatTaskWhen(patch.due_date, patch.due_time, timeFormat, today)}`;
}
