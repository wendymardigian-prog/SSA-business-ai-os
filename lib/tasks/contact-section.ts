/**
 * Las tareas de un contacto, para su ficha (Extra A, F20). La RLS decide cuales ve cada quien: un Member solo ve las que
 * creo, tiene a cargo o sigue.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { TASK_COLUMNS } from "./core";
import { RECENT_COMPLETED, splitOpenDone } from "./contact-tasks";
import type { TaskRow } from "./types";

type Db = SupabaseClient<Database>;

export { RECENT_COMPLETED };

/** Las abiertas (por vencimiento, las sin fecha al final) y las ultimas completadas. */
export function pickContactTasks(rows: readonly TaskRow[]): { open: TaskRow[]; completed: TaskRow[] } {
  const { open, done } = splitOpenDone(rows);
  return { open, completed: done.slice(0, RECENT_COMPLETED) };
}

const FETCH_LIMIT = 100;

/** Lee las tareas del contacto y dice si la lectura fallo (la pantalla muestra un error con «Reintentar», no «vacio»). */
export async function loadContactTasksChecked(db: Db, input: { workspaceId: string; contactId: string }): Promise<{ tasks: TaskRow[]; failed: boolean }> {
  const { data, error } = await db
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("workspace_id", input.workspaceId)
    .eq("contact_id", input.contactId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(FETCH_LIMIT);
  if (error) {
    console.error("[tareas] no pude leer las tareas del contacto:", error.message);
    return { tasks: [], failed: true };
  }
  const { open, completed } = pickContactTasks((data ?? []) as unknown as TaskRow[]);
  return { tasks: [...open, ...completed], failed: false };
}

export async function loadContactTasks(db: Db, input: { workspaceId: string; contactId: string }): Promise<TaskRow[]> {
  return (await loadContactTasksChecked(db, input)).tasks;
}

/** Lo que el panel de la bandeja necesita para dibujar la seccion «Tareas» de un contacto. */
export interface ContactTasksPayload {
  tasks: TaskRow[];
  members: Array<{ id: string; name: string }>;
  /** AAAA-MM-DD en la zona del workspace. */
  today: string;
  timeZone: string;
  currentUserId: string;
  canEdit: boolean;
  canDelete: boolean;
}

/** Lo que el drawer necesita ademas de las tareas que ya tiene en pantalla (dependencias, proyectos, nombres). */
export interface TaskContextPayload {
  tasks: TaskRow[];
  contactNames: Record<string, string>;
  flowNames: Record<string, string>;
}
