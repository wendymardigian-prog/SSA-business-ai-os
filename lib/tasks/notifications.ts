/**
 * Los avisos de Tareas en la campana (Extra A, F17).
 *
 * Reglas que no se discuten:
 *  - Siempre a una persona concreta (`recipient_id`): nunca el atajo «null = Owner/Admin».
 *  - NUNCA a quien hizo la accion.
 *  - Nada de esto frena ni revierte la operacion: `sendTaskNotifications` no lanza.
 *  - Sin email ni WhatsApp: solo campana.
 *
 * `plan*` son funciones PURAS que dicen a quien y que avisar; `sendTaskNotifications` las escribe.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createNotification, createNotificationOnce } from "@/lib/notifications/create";
import type { NotificationType } from "@/lib/notifications/types";
import type { Database } from "@/lib/types/database";
import { formatDayShort } from "./format";
import { STATUS_LABELS, type TaskRow } from "./types";

type Db = SupabaseClient<Database>;

export type TaskNotificationType = Extract<
  NotificationType,
  "task_assigned" | "task_follow_added" | "task_changed" | "task_unblocked" | "task_date_moved" | "task_due_today" | "task_overdue"
>;

export interface TaskNotice {
  type: TaskNotificationType;
  recipientId: string;
  taskId: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  /** `task_changed` no se repite: maximo uno SIN LEER por persona y tarea cada 10 minutos. */
  throttleMinutes?: number;
}

export const CHANGE_THROTTLE_MINUTES = 10;

interface Actor {
  id: string;
  name: string;
}

/** Quita al actor, a quien no tiene id y los repetidos (mismo tipo, persona y tarea). */
function finalize(notices: TaskNotice[], actorId: string): TaskNotice[] {
  const seen = new Set<string>();
  const out: TaskNotice[] = [];
  for (const n of notices) {
    if (!n.recipientId || n.recipientId === actorId) continue;
    const key = `${n.type}:${n.recipientId}:${n.taskId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

const quote = (title: string) => `«${title}»`;

/** Una tarea nueva: avisa al responsable (si no es quien la crea) y a cada seguidor. */
export function planCreated(task: Pick<TaskRow, "id" | "title" | "owner_id" | "follower_ids">, actor: Actor): TaskNotice[] {
  const notices: TaskNotice[] = [];
  if (task.owner_id) {
    notices.push({ type: "task_assigned", recipientId: task.owner_id, taskId: task.id, title: `${actor.name} te asignó ${quote(task.title)}` });
  }
  for (const id of task.follower_ids) {
    notices.push({ type: "task_follow_added", recipientId: id, taskId: task.id, title: `${actor.name} te agregó como seguidor de ${quote(task.title)}` });
  }
  return finalize(notices, actor.id);
}

type Watched = Pick<TaskRow, "id" | "title" | "status" | "due_date" | "owner_id" | "follower_ids">;

/** Lo que cambio de una tarea, en una frase para el cuerpo del aviso. */
function describeChanges(before: Watched, after: Watched, today: string): string[] {
  const parts: string[] = [];
  if (before.status !== after.status) parts.push(`Estado: ${STATUS_LABELS[after.status]}`);
  if (before.due_date !== after.due_date) parts.push(after.due_date ? `Vence el ${formatDayShort(after.due_date, today)}` : "Sin fecha de vencimiento");
  if (before.owner_id !== after.owner_id) parts.push("Cambió el responsable");
  return parts;
}

/**
 * Una tarea editada. Asignacion y seguidores nuevos tienen su propio aviso; cualquier otro cambio de estado, fecha o
 * responsable avisa (`task_changed`) al responsable y a los seguidores, con tope de repeticion.
 */
export function planUpdated(before: Watched, after: Watched, actor: Actor, today: string): TaskNotice[] {
  const notices: TaskNotice[] = [];
  const already = new Set<string>();

  if (after.owner_id && after.owner_id !== before.owner_id) {
    notices.push({ type: "task_assigned", recipientId: after.owner_id, taskId: after.id, title: `${actor.name} te asignó ${quote(after.title)}` });
    already.add(after.owner_id);
  }
  for (const id of after.follower_ids) {
    if (before.follower_ids.includes(id)) continue;
    notices.push({ type: "task_follow_added", recipientId: id, taskId: after.id, title: `${actor.name} te agregó como seguidor de ${quote(after.title)}` });
    already.add(id);
  }

  const changes = describeChanges(before, after, today);
  if (changes.length > 0) {
    const audience = [after.owner_id, ...after.follower_ids].filter((id): id is string => !!id && !already.has(id));
    for (const id of audience) {
      notices.push({
        type: "task_changed",
        recipientId: id,
        taskId: after.id,
        title: `${actor.name} actualizó ${quote(after.title)}`,
        body: changes.join(" · "),
        throttleMinutes: CHANGE_THROTTLE_MINUTES,
      });
    }
  }
  return finalize(notices, actor.id);
}

export interface CompletionFacts {
  task: Watched;
  /** Las tareas cuyas fechas se movieron, con su fila actual (responsable y seguidores). */
  moved: Array<{ row: Watched; toDue: string }>;
  /** Las que quedaron sin bloqueantes pendientes. */
  unblocked: Array<{ task_id: string; title: string; owner_id: string | null }>;
}

/** Completar una tarea: avisa a quien la sigue, a quien queda libre y a quien le movieron la fecha. */
export function planCompleted(facts: CompletionFacts, actor: Actor, today: string): TaskNotice[] {
  const notices: TaskNotice[] = [];
  const { task } = facts;

  for (const id of [task.owner_id, ...task.follower_ids]) {
    if (!id) continue;
    notices.push({
      type: "task_changed",
      recipientId: id,
      taskId: task.id,
      title: `${actor.name} completó ${quote(task.title)}`,
      body: `Estado: ${STATUS_LABELS.completed}`,
      throttleMinutes: CHANGE_THROTTLE_MINUTES,
    });
  }

  for (const u of facts.unblocked) {
    if (!u.owner_id) continue;
    notices.push({
      type: "task_unblocked",
      recipientId: u.owner_id,
      taskId: u.task_id,
      title: `${quote(u.title)} quedó libre`,
      body: `Se completó ${quote(task.title)}, de la que dependía.`,
    });
  }

  for (const m of facts.moved) {
    for (const id of [m.row.owner_id, ...m.row.follower_ids]) {
      if (!id) continue;
      notices.push({
        type: "task_date_moved",
        recipientId: id,
        taskId: m.row.id,
        title: `Se movió la fecha de ${quote(m.row.title)} al ${formatDayShort(m.toDue, today)}`,
        body: `Porque se completó ${quote(task.title)}.`,
        metadata: { due_date: m.toDue },
      });
    }
  }
  return finalize(notices, actor.id);
}

/** Escribe los avisos. No lanza nunca: un aviso que falla no deshace lo que ya se hizo. */
export async function sendTaskNotifications(db: Db, workspaceId: string, notices: TaskNotice[]): Promise<void> {
  await Promise.all(
    notices.map(async (n) => {
      try {
        const args = {
          supabase: db,
          workspaceId,
          type: n.type,
          title: n.title,
          body: n.body,
          entityType: "task" as const,
          entityId: n.taskId,
          recipientId: n.recipientId,
          metadata: { task_id: n.taskId, ...(n.metadata ?? {}) },
        };
        if (n.throttleMinutes) await createNotificationOnce({ ...args, withinMinutes: n.throttleMinutes, perRecipient: true });
        else await createNotification(args);
      } catch (error) {
        console.error(`[tareas] no pude avisar (${n.type}):`, error instanceof Error ? error.message : String(error));
      }
    }),
  );
}
