import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { AI_TASKS, type AiTaskId } from "./catalog";
import { CLASSIFY_DEFAULT_INSTRUCTIONS, MEDIA_DESCRIPTION_DEFAULT_INSTRUCTIONS, SUMMARY_DEFAULT_INSTRUCTIONS } from "./instructions";

type Db = SupabaseClient<Database>;

/** Las tareas que de verdad guardan versiones (00137: el CHECK solo admite estas tres). */
type VersionedTask = "message_classification" | "conversation_summary" | "media_description";

const DEFAULT_TEXT: Record<VersionedTask, string> = {
  message_classification: CLASSIFY_DEFAULT_INSTRUCTIONS,
  conversation_summary: SUMMARY_DEFAULT_INSTRUCTIONS,
  media_description: MEDIA_DESCRIPTION_DEFAULT_INSTRUCTIONS,
};

function isVersioned(task: AiTaskId): task is VersionedTask {
  return task in DEFAULT_TEXT;
}

export interface TaskInstructions {
  /** null = el texto del sistema (v0): no hay fila en ai_task_prompt_versions. */
  version: number | null;
  text: string;
}

export interface TaskPromptVersion {
  version: number;
  instructions: string;
  note: string | null;
  createdAt: string;
  authorLabel: string | null;
}

/**
 * Las instrucciones activas de una tarea. Nunca lanza: si algo falla al leer
 * (RLS, red, columna que todavia no llego a este ambiente), se cae al texto
 * del sistema para que la tarea siga corriendo igual que hoy.
 */
export async function loadTaskInstructions(service: Db, workspaceId: string, task: AiTaskId): Promise<TaskInstructions> {
  if (!isVersioned(task)) return { version: null, text: "" };
  const fallback: TaskInstructions = { version: null, text: DEFAULT_TEXT[task] };
  try {
    const { data: ws, error: wsError } = await service
      .from("workspaces")
      .select("ai_task_prompt_active")
      .eq("id", workspaceId)
      .maybeSingle();
    if (wsError || !ws) return fallback;
    const active = (ws.ai_task_prompt_active ?? {}) as Record<string, number>;
    const version = active[task];
    if (!version) return fallback;

    const { data: row, error } = await service
      .from("ai_task_prompt_versions")
      .select("version, instructions")
      .eq("workspace_id", workspaceId)
      .eq("task", task)
      .eq("version", version)
      .maybeSingle();
    if (error || !row) return fallback;
    return { version: row.version, text: row.instructions };
  } catch (err) {
    console.error(`[ai-tasks] no pude leer las instrucciones de ${task}, uso el texto del sistema:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

/** El historial completo de una tarea, mas nueva primero. Para la pestana Instrucciones. */
export async function loadTaskPromptVersions(
  supabase: Db,
  workspaceId: string,
  task: AiTaskId,
  memberNames: Map<string, string>,
): Promise<TaskPromptVersion[]> {
  if (!isVersioned(task)) return [];
  const { data, error } = await supabase
    .from("ai_task_prompt_versions")
    .select("version, instructions, note, created_at, created_by")
    .eq("workspace_id", workspaceId)
    .eq("task", task)
    .order("version", { ascending: false });
  if (error) {
    console.error(`[ai-tasks] no pude leer el historial de ${task}:`, error.message);
    return [];
  }
  return (data ?? []).map((v) => ({
    version: v.version,
    instructions: v.instructions,
    note: v.note,
    createdAt: v.created_at,
    authorLabel: v.created_by ? (memberNames.get(v.created_by) ?? null) : null,
  }));
}

export function defaultInstructionsFor(task: AiTaskId): string {
  return isVersioned(task) ? DEFAULT_TEXT[task] : "";
}

export function taskIsVersioned(task: AiTaskId): boolean {
  return isVersioned(task);
}
