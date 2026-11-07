/**
 * El job `design_content_sync`: Sincronizar archivos con Contenido (F64). Lo construye DS8.
 *
 * Contrato de la Ola 1: el tipo ya está registrado (un tipo sin handler no
 * existe) y por ahora solo anota que todavía no está construido. Nunca lanza.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export const DESIGN_CONTENT_SYNC_JOB = "design_content_sync";

export async function runContentSync(_db: SupabaseClient<Database>, _payload: Record<string, unknown>): Promise<{ status: "not_built" }> {
  console.warn("[design_content_sync] todavía no está construido (DS8)");
  return { status: "not_built" };
}
