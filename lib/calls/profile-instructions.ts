/**
 * Las instrucciones de un analizador: su version activa; si no tiene, las generales de la tarea
 * en el formato de ventas o el texto del sistema en el general. Nunca lanza: como las de las tareas,
 * un fallo al leer cae al texto de respaldo para que el analisis siga corriendo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { CALL_ANALYSIS_GENERAL_DEFAULT_INSTRUCTIONS, interpolate } from "@/lib/ai-tasks/instructions";
import { loadTaskInstructions, workspaceOwnStyle, type TaskInstructions } from "@/lib/ai-tasks/store";
import type { CallAnalysisProfile } from "./profiles";

type Db = SupabaseClient<Database>;

type ProfileRef = Pick<CallAnalysisProfile, "id" | "shape" | "activePromptVersion">;

export async function loadProfileInstructions(db: Db, workspaceId: string, profile: ProfileRef): Promise<TaskInstructions> {
  const fallback = async (): Promise<TaskInstructions> =>
    profile.shape === "general"
      ? { version: null, text: CALL_ANALYSIS_GENERAL_DEFAULT_INSTRUCTIONS }
      : loadTaskInstructions(db, workspaceId, "call_analysis");
  if (!profile.activePromptVersion) return fallback();
  try {
    const { data, error } = await db
      .from("ai_task_prompt_versions")
      .select("version, instructions")
      .eq("workspace_id", workspaceId)
      .eq("task", "call_analysis")
      .eq("variant", profile.id)
      .eq("version", profile.activePromptVersion)
      .maybeSingle();
    if (error || !data) return fallback();
    return { version: data.version, text: data.instructions };
  } catch (err) {
    console.error("[llamadas] no pude leer las instrucciones del analizador, uso las de respaldo:", err instanceof Error ? err.message : "error");
    return fallback();
  }
}

/** Para CORRER: con el tono del negocio ya puesto, igual que `loadTaskInstructionsForRun`. */
export async function loadProfileInstructionsForRun(db: Db, workspaceId: string, profile: ProfileRef): Promise<TaskInstructions> {
  const [instructions, style] = await Promise.all([loadProfileInstructions(db, workspaceId, profile), workspaceOwnStyle(db, workspaceId)]);
  return style ? { ...instructions, text: interpolate(instructions.text, { estilo: style }) } : instructions;
}
