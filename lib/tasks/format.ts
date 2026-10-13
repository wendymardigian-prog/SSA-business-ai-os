/**
 * Textos de Tareas que se repiten en la tabla, el tablero y el drawer. PURO.
 */

import { addDays, diffDays } from "./dates";
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

export type DueTone = "overdue" | "today" | "soon" | "normal" | "none" | "done";

export interface DueLabel {
  text: string;
  tone: DueTone;
}

/**
 * Como se muestra un vencimiento: «Hoy», «Mañana», «Ayer», «Hace 3 días» (vencida) o la fecha.
 * Una tarea completada nunca se muestra como vencida.
 */
export function dueLabel(task: Pick<TaskRow, "due_date" | "status">, today: string): DueLabel {
  if (!task.due_date) return { text: "Sin fecha", tone: "none" };
  const days = diffDays(today, task.due_date);
  const date = formatDayShort(task.due_date, today);
  if (task.status === "completed") return { text: date, tone: "done" };
  if (days === 0) return { text: "Hoy", tone: "today" };
  if (days === 1) return { text: "Mañana", tone: "soon" };
  if (days === -1) return { text: "Ayer", tone: "overdue" };
  if (days < -1) return { text: `Hace ${-days} días`, tone: "overdue" };
  if (days <= 6) return { text: date, tone: "soon" };
  return { text: date, tone: "normal" };
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
