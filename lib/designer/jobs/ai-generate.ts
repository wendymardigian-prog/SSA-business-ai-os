/**
 * El job `design_ai_generate`: La IA diseña o cambia un diseño (F33, F34). Lo construye DS3.
 *
 * Contrato de la Ola 1: el tipo ya está registrado (un tipo sin handler no
 * existe) y por ahora solo anota que todavía no está construido. Nunca lanza.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export const DESIGN_AI_GENERATE_JOB = "design_ai_generate";

export async function runAiGenerate(_db: SupabaseClient<Database>, _payload: Record<string, unknown>): Promise<{ status: "not_built" }> {
  console.warn("[design_ai_generate] todavía no está construido (DS3)");
  return { status: "not_built" };
}
