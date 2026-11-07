/**
 * F48b: un solo juego de archivos por diseño propio. Lo construye DS5
 * (`replaceRenderSet`): después de guardar el juego nuevo, borra del bucket los
 * archivos del anterior. Las generaciones NUNCA llegan acá (conservan todo).
 *
 * Contrato de la Ola 1: hoy no borra nada (no pierde nada, solo ocupa lugar).
 *
 * Solo servidor. Nunca lanza.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { RenderSet } from "./render";

export async function releasePreviousRenders(_db: SupabaseClient<Database>, _previous: unknown, _next: RenderSet): Promise<void> {
  // Lo implementa DS5.
}
