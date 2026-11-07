/**
 * El job `design_generate_many`: Generar para varios (F51). Lo construye DS6.
 *
 * Contrato de la Ola 1: el tipo ya está registrado (un tipo sin handler no
 * existe) y por ahora solo anota que todavía no está construido. Nunca lanza.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export const DESIGN_GENERATE_MANY_JOB = "design_generate_many";

export async function runGenerateMany(_db: SupabaseClient<Database>, _payload: Record<string, unknown>): Promise<{ status: "not_built" }> {
  console.warn("[design_generate_many] todavía no está construido (DS6)");
  return { status: "not_built" };
}
