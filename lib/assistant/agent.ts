import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { DEFAULT_ASSISTANT_TOOL_KEYS } from "@/lib/ai-tools/registry";

/**
 * El agente del asistente del equipo (traído de RER, B-IA-27/28). Uno por negocio (`type = 'assistant'`, índice único
 * de la 00444), con su modelo, sus topes y las herramientas que ofrece (`allowed_tools`). Nace APAGADO: lo prende un
 * Owner o Admin en Agentes IA › Asistente del equipo. Lo usa quien tiene «Usar el asistente» (`assistant.use`).
 */

type Service = SupabaseClient<Database>;

export const ASSISTANT_AGENT_TYPE = "assistant";
export const ASSISTANT_AGENT_NAME = "Asistente del equipo";

export const DEFAULT_ASSISTANT_PROMPT = [
  "Sos el asistente del equipo de este negocio. Ayudás a las personas del equipo a encontrar información y a preparar tareas.",
  "Respondé corto y claro, en español rioplatense (vos), sin relleno.",
  "Si el pedido necesita más de un paso, anotá primero tu plan con la herramienta del plan.",
  "Consultá con tus herramientas antes de afirmar un dato: no inventes nombres, fechas, montos ni estados.",
  "Si algo no está en lo que podés ver, decilo.",
].join("\n");

/** El modelo de serie: Anthropic si está conectado (no se cambia el proveedor por defecto de SSA), si no, el primero. Pura. */
export function pickAssistantModel(connected: ReadonlyArray<{ provider: string; defaultModel: string }>): { provider: string; model: string | null } | null {
  const chosen = connected.find((p) => p.provider === "anthropic") ?? connected[0];
  if (!chosen) return null;
  return { provider: chosen.provider, model: chosen.defaultModel || null };
}

/**
 * Crea el asistente APAGADO si el negocio todavía no tiene uno. Idempotente: el índice único de la 00444 frena una
 * segunda fila si dos pedidos llegan a la vez. Nunca prende nada ni pisa lo que eligió una persona. Nunca lanza.
 */
export async function ensureAssistantAgent(
  service: Service,
  workspaceId: string,
  connected: ReadonlyArray<{ provider: string; defaultModel: string }>,
): Promise<{ created: boolean; agentId: string | null }> {
  try {
    const { data: existing, error: readError } = await service
      .from("agents")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("type", ASSISTANT_AGENT_TYPE)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (readError) {
      console.error("[assistant] no pude buscar el agente:", readError.message);
      return { created: false, agentId: null };
    }
    if (existing) return { created: false, agentId: existing.id };

    const model = pickAssistantModel(connected);
    const { data, error } = await service
      .from("agents")
      .insert({
        workspace_id: workspaceId,
        name: ASSISTANT_AGENT_NAME,
        type: ASSISTANT_AGENT_TYPE,
        is_enabled: false,
        system_prompt: DEFAULT_ASSISTANT_PROMPT,
        provider: model?.provider ?? null,
        model: model?.model ?? null,
        allowed_tools: [...DEFAULT_ASSISTANT_TOOL_KEYS],
      })
      .select("id")
      .single();
    if (error) {
      // 23505: otro pedido lo creó al mismo tiempo. No es un error.
      if (error.code !== "23505") console.error("[assistant] no pude crear el agente:", error.message);
      return { created: false, agentId: null };
    }
    return { created: true, agentId: (data as { id: string }).id };
  } catch (err) {
    console.error("[assistant] no pude preparar el agente:", err instanceof Error ? err.message : String(err));
    return { created: false, agentId: null };
  }
}
