/**
 * El tono de la IA de UN negocio, leido de la base (00266). Solo servidor.
 *
 * Nunca lanza: ante cualquier error, el de la instalacion (lo de siempre). Un
 * prompt nunca deja de armarse por no poder leer el tono.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { aiLanguageStyle } from "./language-style";

export async function loadLanguageStyle(db: SupabaseClient<Database>, workspaceId: string): Promise<string> {
  try {
    const { data } = await db.from("workspaces").select("ai_language_style").eq("id", workspaceId).maybeSingle();
    return aiLanguageStyle(data?.ai_language_style);
  } catch {
    return aiLanguageStyle();
  }
}
