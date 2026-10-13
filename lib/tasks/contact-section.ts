/**
 * Las tareas de un contacto, para su ficha (Extra A, F20). La RLS decide cuales ve cada quien: un Member solo ve las que
 * creo, tiene a cargo o sigue.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { TASK_COLUMNS } from "./core";
import type { TaskRow } from "./types";

type Db = SupabaseClient<Database>;

/** Cuantas completadas recientes se muestran. */
export const RECENT_COMPLETED = 5;
const FETCH_LIMIT = 100;

/** Las abiertas (por vencimiento, las sin fecha al final) y las ultimas completadas. */
export function pickContactTasks(rows: readonly TaskRow[]): { open: TaskRow[]; completed: TaskRow[] } {
  const open = rows
    .filter((t) => t.status !== "completed")
    .sort((a, b) => {
      if (a.due_date === b.due_date) return a.created_at < b.created_at ? -1 : 1;
      if (a.due_date === null) return 1;
      if (b.due_date === null) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    });
  const completed = rows
    .filter((t) => t.status === "completed")
    .sort((a, b) => ((b.completed_at ?? b.updated_at) < (a.completed_at ?? a.updated_at) ? -1 : 1))
    .slice(0, RECENT_COMPLETED);
  return { open, completed };
}

export async function loadContactTasks(db: Db, input: { workspaceId: string; contactId: string }): Promise<TaskRow[]> {
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
    return [];
  }
  const { open, completed } = pickContactTasks((data ?? []) as unknown as TaskRow[]);
  return [...open, ...completed];
}
