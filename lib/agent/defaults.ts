import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { DEFAULT_COPYWRITER_INSTRUCTIONS } from "@/lib/content/copywriter";

/**
 * Deja los agentes listos para usar apenas hay una IA conectada (00252).
 *
 * Con la primera IA conectada: el agente de chat existe (apagado, sin canales,
 * con el prompt inicial), el chat y el copywriter tienen proveedor y modelo, y
 * el copywriter tiene sus instrucciones iniciales (queda apagado: se prende a
 * mano). Todo lo hace `ensure_default_agents` en una transaccion, que nunca
 * pisa algo elegido por una persona ni resucita un agente borrado.
 *
 * La llaman `saveIntegration` (al guardar una IA) y la pantalla de Agentes IA
 * (asi se completan los negocios que ya tenian la IA conectada). Siempre con el
 * cliente de servicio y DESPUES de que quien llama chequeo el permiso; el
 * workspace sale de la sesion.
 *
 * Nunca lanza: si falla, la pantalla se dibuja igual y lo intenta la proxima vez.
 */

type Service = SupabaseClient<Database>;

export interface EnsureDefaultAgentsResult {
  chatAgentCreated: boolean;
  chatAgentId: string | null;
  modelsSet: number;
  copywriterInstructionsSet: boolean;
}

/** Sin IA conectada no hace nada: el modelo de cada agente sale de la primera que haya. */
export async function ensureDefaultAgents(
  service: Service,
  workspaceId: string,
  /** Las IAs conectadas, si quien llama ya las tiene: evita leerlas dos veces. */
  connected?: ReadonlyArray<{ provider: string; defaultModel: string }>,
): Promise<EnsureDefaultAgentsResult | null> {
  try {
    const [first] = connected ?? (await listConnectedAiProviders(workspaceId, service));
    if (!first) return null;

    const { data, error } = await service.rpc("ensure_default_agents", {
      p_workspace_id: workspaceId,
      p_provider: first.provider,
      p_model: first.defaultModel || null,
      p_chat_prompt: DEFAULT_AGENT_SYSTEM_PROMPT,
      p_copywriter_instructions: DEFAULT_COPYWRITER_INSTRUCTIONS,
    });
    if (error) {
      console.error("[agents] no pude preconfigurar los agentes:", error.message);
      return null;
    }
    const result = (data ?? {}) as Record<string, unknown>;
    return {
      chatAgentCreated: result.chat_agent_created === true,
      chatAgentId: typeof result.chat_agent_id === "string" ? result.chat_agent_id : null,
      modelsSet: typeof result.models_set === "number" ? result.models_set : 0,
      copywriterInstructionsSet: result.copywriter_instructions_set === true,
    };
  } catch (err) {
    console.error("[agents] no pude preconfigurar los agentes:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
