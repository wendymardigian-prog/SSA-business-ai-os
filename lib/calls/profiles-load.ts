/**
 * Leer los perfiles de analisis de un negocio. Ante un error devuelve la lista vacia: sin perfil
 * una grabacion no se analiza, que es lo seguro cuando no se sabe (no gasta IA por las dudas).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { parseProfile, type CallAnalysisProfile } from "./profiles";

type Db = SupabaseClient<Database>;

export async function loadCallProfiles(db: Db, workspaceId: string): Promise<CallAnalysisProfile[]> {
  const { data, error } = await db
    .from("call_analysis_profiles")
    .select("id, workspace_id, category_id, shape, mode, rules, rubric, auto_summary, auto_memory, auto_knowledge, active_prompt_version")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null);
  if (error) {
    console.error("[llamadas] no pude leer los analizadores:", error.message);
    return [];
  }
  return (data ?? []).map((row) => parseProfile(row as unknown as Record<string, unknown>));
}
