import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { AI_KEY_PROVIDERS, aiKeyProviderStates, type AiKeyProviderState, type AiKeyRow } from "./provider-states";

/**
 * Lee el estado de las claves de IA del negocio para Agentes IA. Con el cliente de servicio, filtrando
 * por el negocio de la sesión: la pantalla la ve quien tiene `agents.view`, que no siempre puede leer
 * `integration_configs`. Solo viajan proveedor, si está activa, el error y la fecha: nunca la clave (que vive en
 * Vault). Si la base no contesta, los tres quedan «Sin conectar» y se anota en el log.
 */
export async function loadAiKeyProviderStates(service: SupabaseClient<Database>, workspaceId: string): Promise<AiKeyProviderState[]> {
  const { data, error } = await service
    .from("integration_configs")
    .select("provider, is_active, last_error, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("type", "ai_provider")
    .in(
      "provider",
      AI_KEY_PROVIDERS.map((p) => p.id),
    );
  if (error) console.error("[ai-key] no pude leer el estado de las claves:", error.message);
  return aiKeyProviderStates((data ?? []) as AiKeyRow[]);
}
