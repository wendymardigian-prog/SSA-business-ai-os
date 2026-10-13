/**
 * Emitir los eventos de Tareas a la cola de automatizaciones (Extra A, F25).
 *
 * NUNCA lanza ni frena la operacion que lo origina («events never break origin»): completar una tarea o barrer los
 * vencimientos no pueden fallar porque un flujo no se pudo encolar. Una tarea con contacto emite sobre el contacto; sin
 * contacto, sobre la persona del equipo a cargo (responsable, si no quien la creo, si no quien hizo el cambio); si no hay
 * ninguna persona, no se emite (el motor necesita un sujeto) y queda en el log.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import type { TaskRow } from "../types";
import { eventSubjectPerson, taskEventPayload, type TaskEventType } from "./payload";

type Db = SupabaseClient<Database>;

type EmittableTask = Pick<TaskRow, "id" | "workspace_id" | "title" | "project" | "project_key" | "status" | "source" | "priority" | "due_date" | "completed_at" | "contact_id" | "owner_id" | "created_by">;

export async function emitTaskEvent(db: Db, type: TaskEventType, task: EmittableTask, actorId?: string | null): Promise<boolean> {
  try {
    const personId = task.contact_id ? null : eventSubjectPerson(task, actorId);
    if (!task.contact_id && !personId) {
      console.warn(`[tareas] el evento ${type} de la tarea ${task.id} no se emite: no tiene contacto ni persona a cargo`);
      return false;
    }
    const { error } = await db.from("automation_events").insert({
      workspace_id: task.workspace_id,
      event_type: type,
      contact_id: task.contact_id,
      member_user_id: personId,
      payload: taskEventPayload(task) as unknown as Json,
    });
    if (error) {
      console.error(`[tareas] no pude emitir ${type}:`, error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[tareas] no pude emitir ${type}:`, error instanceof Error ? error.message : String(error));
    return false;
  }
}
