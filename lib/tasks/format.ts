/**
 * Textos de Tareas que se repiten en la tabla, el tablero y el drawer. PURO.
 */

import { addDays, diffDays } from "./dates";
import { formatTime, type TimeFormat } from "./time";
import type { TaskRow, TaskSource } from "./types";

/** dd/mm/aaaa */
export function formatDay(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

/** dd/mm, o dd/mm/aaaa si no es del ano de `today`. */
export function formatDayShort(date: string, today: string): string {
  const [y, m, d] = date.split("-");
  return y === today.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`;
}

const WEEKDAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

/** «mié 16 oct», o «mié 16 oct 2027» si no es del año de `today`. Para el selector de fecha del drawer. */
export function formatDayLong(date: string, today: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const base = `${weekday} ${d} ${MONTHS_SHORT[m - 1]}`;
  return String(y) === today.slice(0, 4) ? base : `${base} ${y}`;
}

export type DueTone = "overdue" | "today" | "soon" | "normal" | "none" | "done";

export interface DueLabel {
  text: string;
  tone: DueTone;
}

/**
 * Como se muestra un vencimiento: «Hoy», «Mañana», «Ayer», «Hace 3 días» (vencida) o la fecha.
 * Una tarea completada nunca se muestra como vencida.
 */
export function dueLabel(task: Pick<TaskRow, "due_date" | "status"> & { due_time?: string | null }, today: string, timeFormat?: TimeFormat): DueLabel {
  if (!task.due_date) return { text: "Sin fecha", tone: "none" };
  const days = diffDays(today, task.due_date);
  const date = formatDayShort(task.due_date, today);
  // Con hora (y con el formato 12 h / 24 h de quien mira) se le suma a la fecha: «Hoy · 14:30». Las reglas de fechas son
  // por DIA: la hora no cambia el tono (una tarea de hoy a las 09:00 no esta «vencida» a las 10:00).
  const at = timeFormat && task.due_time ? ` · ${formatTime(task.due_time, timeFormat)}` : "";
  if (task.status === "completed") return { text: `${date}${at}`, tone: "done" };
  if (days === 0) return { text: `Hoy${at}`, tone: "today" };
  if (days === 1) return { text: `Mañana${at}`, tone: "soon" };
  if (days === -1) return { text: `Ayer${at}`, tone: "overdue" };
  if (days < -1) return { text: `Hace ${-days} días${at}`, tone: "overdue" };
  if (days <= 6) return { text: `${date}${at}`, tone: "soon" };
  return { text: `${date}${at}`, tone: "normal" };
}

/**
 * La fecha de una tarea con su hora para mostrar: «20/10/2026 · 14:30» (24 h) o «20/10/2026 · 2:30 p. m.» (12 h); sin
 * hora, solo la fecha. Con `today` la fecha se acorta como en las tablas (sin el ano si es de este ano).
 */
export function formatTaskWhen(date: string, time: string | null | undefined, timeFormat: TimeFormat, today?: string): string {
  const day = today ? formatDayShort(date, today) : formatDay(date);
  const at = formatTime(time, timeFormat);
  return at ? `${day} · ${at}` : day;
}

export function pluralDays(n: number): string {
  return n === 1 ? "1 día" : `${n} días`;
}

// ── Origen ──────────────────────────────────────────────────────────────────

export interface SourceInfo {
  label: string;
  /** A donde lleva el origen, si hay adonde. */
  href: string | null;
}

export interface SourceContext {
  /** id del flujo -> nombre. */
  flowNames?: ReadonlyMap<string, string>;
}

/** `flow_id:run:nodo` -> el id del flujo (o null si no tiene esa forma). */
export function flowIdOf(sourceRef: string | null): string | null {
  if (!sourceRef) return null;
  const id = sourceRef.split(":")[0];
  return /^[0-9a-f][0-9a-f-]{7,63}$/i.test(id) ? id : null;
}

/**
 * El origen de una tarea: «Manual», «Flujo: <nombre>», «Agente» o «CX», con el enlace al flujo o a la
 * conversacion cuando existe (F26).
 */
export function formatSource(
  task: Pick<TaskRow, "source" | "source_ref" | "conversation_id">,
  ctx: SourceContext = {},
): SourceInfo {
  switch (task.source as TaskSource) {
    case "manual":
      return { label: "Manual", href: null };
    case "flow": {
      const id = flowIdOf(task.source_ref);
      const name = id ? ctx.flowNames?.get(id) : undefined;
      return { label: name ? `Flujo: ${name}` : "Flujo", href: id ? `/dashboard/flows/${id}` : null };
    }
    case "agent":
      return { label: "Agente", href: task.conversation_id ? `/dashboard/inbox?c=${task.conversation_id}` : null };
    case "cx":
      return { label: "CX", href: null };
  }
}

export { addDays };
