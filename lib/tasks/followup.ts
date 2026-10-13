/**
 * La tarea de seguimiento de un contacto (Tareas × CRM, R2). PURO.
 *
 * El «Proximo seguimiento» es `contacts.next_followup_date`, un timestamptz anclado al mediodia de la zona de quien lo
 * guardo. La tarea de esa fecha se reconoce por su `source_ref = 'followup:AAAA-MM-DD'`. El dia se decodifica SIEMPRE con
 * la zona del workspace (la misma para todos, asi dos personas no crean dos tareas): si quien cargo la fecha esta a 12 horas
 * o mas de esa zona, el dia puede correrse. Es un limite conocido y documentado.
 */

import { isoToDateInput } from "@/lib/dates";
import { isDateOnly } from "./dates";
import { TASK_LIMITS, type TaskRow } from "./types";

const PREFIX = "followup:";

/** `followup:2026-10-20`. */
export function followupRef(date: string): string {
  return `${PREFIX}${date}`;
}

/** Si el `source_ref` es el de un seguimiento. */
export function isFollowupRef(ref: string | null | undefined): boolean {
  return typeof ref === "string" && ref.startsWith(PREFIX) && isDateOnly(ref.slice(PREFIX.length));
}

/** El dia (AAAA-MM-DD) de una fecha de seguimiento guardada, en la zona dada; null si no hay fecha o no es valida. */
export function followupDateOf(iso: string | null | undefined, timeZone: string): string | null {
  const day = isoToDateInput(iso, timeZone);
  return day && isDateOnly(day) ? day : null;
}

/**
 * La tarea de seguimiento de ese contacto para esa fecha: la que no esta borrada y cuyo `source_ref` coincide. Si por algun
 * borde hubiera mas de una, la mas reciente. Si la fecha cambio, no hay ninguna: la tarea de la fecha anterior no cuenta
 * (ni se toca).
 */
export function findFollowupTask(tasks: readonly TaskRow[], contactId: string, date: string | null): TaskRow | null {
  if (!date) return null;
  const ref = followupRef(date);
  const matches = tasks.filter((t) => t.contact_id === contactId && t.source_ref === ref && !t.deleted_at);
  if (matches.length === 0) return null;
  return matches.reduce((best, t) => (t.created_at > best.created_at ? t : best));
}

export interface FollowupTaskDraft {
  title: string;
  due_date: string;
  owner_id: string;
  contact_id: string;
  source: "manual";
  source_ref: string;
}

const TITLE_PREFIX = "Seguimiento a ";

/** Lo que se inserta al crear la tarea de seguimiento de un contacto en una fecha. */
export function buildFollowupTask(contact: { id: string; display_name?: string | null; email?: string | null }, date: string, userId: string): FollowupTaskDraft {
  const name = (contact.display_name || contact.email || "").replace(/\s+/g, " ").trim() || "este contacto";
  return {
    title: `${TITLE_PREFIX}${name}`.slice(0, TASK_LIMITS.title),
    due_date: date,
    owner_id: userId,
    contact_id: contact.id,
    source: "manual",
    source_ref: followupRef(date),
  };
}
