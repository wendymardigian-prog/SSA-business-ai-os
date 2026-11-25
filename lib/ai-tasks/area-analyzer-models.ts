import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getExactWorkspaceModel, type AiModelResult } from "@/lib/ai/provider";
import { analyzerAgentForArea } from "@/lib/calls/area-analyzers";

type Db = SupabaseClient<Database>;

/**
 * El analizador de un área (agente declarado: «Analizador de reuniones de Ventas» o «de Servicio») aporta su modelo al
 * análisis de las grabaciones de SU área (`lib/calls/area-analyzers.ts`). Solo si está ENCENDIDO y tiene un modelo
 * elegido: apagado (como nace), o con otra área, todo sigue igual que antes (el modelo de la tarea «Análisis de
 * llamadas»).
 *
 * Con modelo elegido se usa ESE proveedor y ESE modelo y, si el proveedor ya no está conectado, se falla con un mensaje
 * claro: nunca se cambia de modelo en silencio (mismo criterio que `resolveTaskModel`). El respaldo del agente
 * (`fallback_*`) no se usa todavía: las tareas de IA no tienen un motor de respaldo.
 *
 * Si no se puede LEER el agente (red, columna que todavía no llegó), se usa el modelo de la tarea: nunca frena el análisis.
 */
export async function withAreaAnalyzerModel(
  db: Db,
  workspaceId: string,
  taskModel: AiModelResult & { chosen: boolean },
  areaKey: string | null,
): Promise<AiModelResult & { chosen: boolean }> {
  const agentType = analyzerAgentForArea(areaKey);
  if (!agentType) return taskModel;
  try {
    const { data, error } = await db
      .from("agents")
      .select("provider, model, is_enabled")
      .eq("workspace_id", workspaceId)
      .eq("type", agentType)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data || !data.is_enabled || !data.provider || !data.model) return taskModel;
    const exact = await getExactWorkspaceModel(workspaceId, { provider: data.provider, modelId: data.model, supabase: db });
    return { ...exact, chosen: true };
  } catch (err) {
    console.error(`[ai-tasks] no pude leer el modelo del analizador ${agentType}:`, err instanceof Error ? err.message : err);
    return taskModel;
  }
}
