import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { AI_KEY_PROVIDERS, aiKeyRejectedMessage, isAiKeyRejection } from "./provider-states";

type Db = SupabaseClient<Database>;

/**
 * Deja la clave de IA de un proveedor «Con error» cuando el proveedor la rechaza (401/403).
 *
 * Escribe solo `last_error` de la fila activa `ai_provider/<proveedor>` del negocio: la clave sigue en Vault y no
 * se toca. Se limpia al volver a guardarla (`saveIntegration` deja `last_error` en null). Nunca lanza: marcar el
 * estado no puede tumbar lo que estaba fallando. Recibe el cliente de servicio (la RLS de `integration_configs`
 * es de quien tiene `integrations.manage`).
 */
export async function recordAiKeyRejected(
  service: Db,
  args: { workspaceId: string; provider: string; status: number },
): Promise<void> {
  const known = AI_KEY_PROVIDERS.find((p) => p.id === args.provider);
  if (!known || !isAiKeyRejection(args.status)) return;
  try {
    const { error } = await service
      .from("integration_configs")
      .update({ last_error: aiKeyRejectedMessage(known.label, args.status) })
      .eq("workspace_id", args.workspaceId)
      .eq("type", "ai_provider")
      .eq("provider", args.provider)
      .eq("is_active", true);
    if (error) console.error("[ai-key] no pude marcar la clave con error:", error.message);
  } catch (err) {
    console.error("[ai-key] no pude marcar la clave con error:", err instanceof Error ? err.message : "error desconocido");
  }
}
