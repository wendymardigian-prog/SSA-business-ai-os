/**
 * Los dos agentes analizadores por área («Analizador de reuniones de Ventas» y «de Servicio», migración 00536):
 * quién falta, el pedido que recibe `ensure_area_analyzer_agents` y la llamada. Nacen APAGADOS: apagado, el análisis
 * usa el modelo de la tarea «Análisis de llamadas», igual que antes (`lib/ai-tasks/area-analyzer-models.ts`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { AREA_ANALYZER_AGENT_KEYS, type AreaAnalyzerAgentKey } from "./area-analyzers";

export const AREA_ANALYZER_NAMES: Record<AreaAnalyzerAgentKey, string> = {
  sales_analyzer: "Analizador de reuniones de Ventas",
  service_analyzer: "Analizador de reuniones de Servicio",
};

type Connected = ReadonlyArray<{ provider: string; defaultModel: string }>;

/** Los analizadores que todavía no existen entre los agentes vivos. Puro. */
export function areaAnalyzersMissing(agents: ReadonlyArray<{ type: string }>): AreaAnalyzerAgentKey[] {
  return AREA_ANALYZER_AGENT_KEYS.filter((key) => !agents.some((a) => a.type === key));
}

/** El pedido para la base: el proveedor y el modelo de arranque, si hay una IA conectada (van juntos o ninguno). Puro. */
export function areaAnalyzerPayload(missing: readonly AreaAnalyzerAgentKey[], connected: Connected): Json {
  const first = connected.find((c) => c.provider && c.defaultModel);
  return missing.map((type) => ({ type, name: AREA_ANALYZER_NAMES[type], provider: first?.provider ?? null, model: first?.defaultModel ?? null })) as unknown as Json;
}

/** Siempre con el cliente de servicio y DESPUÉS de chequear el permiso. Nunca lanza: devuelve null si falla. */
export async function ensureAreaAnalyzerAgents(
  service: SupabaseClient<Database>,
  workspaceId: string,
  agents: ReadonlyArray<{ type: string }>,
  connected: Connected = [],
): Promise<AreaAnalyzerAgentKey[] | null> {
  const missing = areaAnalyzersMissing(agents);
  if (missing.length === 0) return [];
  try {
    const { data, error } = await service.rpc("ensure_area_analyzer_agents", { p_workspace_id: workspaceId, p_agents: areaAnalyzerPayload(missing, connected) });
    if (error) {
      console.error("[agentes] no pude preparar los analizadores por área:", error.message);
      return null;
    }
    const created = (data as { created?: unknown } | null)?.created;
    return Array.isArray(created) ? created.filter((t): t is AreaAnalyzerAgentKey => AREA_ANALYZER_AGENT_KEYS.includes(t as AreaAnalyzerAgentKey)) : [];
  } catch (err) {
    console.error("[agentes] no pude preparar los analizadores por área:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
