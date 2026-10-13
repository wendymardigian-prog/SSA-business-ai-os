/**
 * Las tareas en el calendario de Agenda (Tareas × CRM, R7). PURO.
 *
 * La fecha y la hora de una tarea son hora local del WORKSPACE; el calendario se dibuja en la zona de quien lo mira.
 * `placeTasksInCalendar` convierte la hora de la tarea a la zona del calendario (si cruza de dia, la coloca en el dia
 * correcto) y deja las tareas sin hora en su fecha tal cual (no tienen instante que convertir).
 */

import { addDays, dateInTz, eachDate, minutesOfDayInTz, wallClockToUtc } from "@/lib/scheduling/time/tz";
import type { WallTime } from "@/lib/scheduling/types";
import type { CalendarView } from "@/lib/scheduling/calendar-view";
import { DEFAULT_DURATION_MINUTES, isValidDuration, normalizeTime } from "./time";
import type { TaskRow } from "./types";

export interface CalendarTaskItem {
  task: TaskRow;
  /** El dia (AAAA-MM-DD) donde se dibuja, en la zona del calendario. */
  date: string;
  /** Con hora: minutos desde la medianoche local del calendario (0-1439). Sin hora: null. */
  startMinutes: number | null;
  /** Con hora: el fin (puede superar 1440 si cruza la medianoche). Sin hora: null. */
  endMinutes: number | null;
  /** Cuanto dura al dibujarla (la suya, o 30 minutos si no tiene). */
  durationMinutes: number;
  timed: boolean;
}

export interface TaskPlacement {
  view: CalendarView;
  items: CalendarTaskItem[];
  /** Todas las fechas del rango (vacias incluidas). Dentro de cada dia: primero las con hora (por hora) y despues las sin hora. */
  byDate: Record<string, CalendarTaskItem[]>;
}

export function placeTasksInCalendar(args: {
  tasks: readonly TaskRow[];
  workspaceTz: string;
  viewerTz: string;
  view: CalendarView;
  range: { from: string; to: string };
}): TaskPlacement {
  const { tasks, workspaceTz, viewerTz, view, range } = args;
  const items: CalendarTaskItem[] = [];

  for (const task of tasks) {
    if (task.deleted_at || !task.due_date) continue;
    const time = normalizeTime(task.due_time);
    const duration = isValidDuration(task.duration_minutes) ? task.duration_minutes : DEFAULT_DURATION_MINUTES;

    if (!time) {
      items.push({ task, date: task.due_date, startMinutes: null, endMinutes: null, durationMinutes: duration, timed: false });
      continue;
    }
    // La hora de pared del workspace -> el instante -> el dia y la hora de la zona de quien mira.
    const instant = wallClockToUtc(task.due_date, time as WallTime, workspaceTz);
    const start = minutesOfDayInTz(instant, viewerTz);
    items.push({ task, date: dateInTz(instant, viewerTz), startMinutes: start, endMinutes: start + duration, durationMinutes: duration, timed: true });
  }

  const byDate: Record<string, CalendarTaskItem[]> = {};
  for (const d of eachDate(range.from, range.to)) byDate[d] = [];
  for (const item of items) if (byDate[item.date]) byDate[item.date].push(item);
  for (const list of Object.values(byDate)) {
    list.sort((a, b) => {
      if (a.timed !== b.timed) return a.timed ? -1 : 1;
      if (a.timed && b.timed && a.startMinutes !== b.startMinutes) return (a.startMinutes as number) - (b.startMinutes as number);
      return a.task.created_at < b.task.created_at ? -1 : a.task.created_at > b.task.created_at ? 1 : a.task.id < b.task.id ? -1 : 1;
    });
  }
  return { view, items: items.filter((i) => byDate[i.date]), byDate };
}

/** El rango de fechas de la base que hay que pedir para cubrir un rango del calendario, con un dia de margen por la zona. */
export function dueDateWindow(range: { from: string; to: string }): { from: string; to: string } {
  return { from: addDays(range.from, -1), to: addDays(range.to, 1) };
}
