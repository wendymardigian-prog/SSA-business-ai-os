/**
 * Lee lo que muestra «Agentes IA» de Grabaciones (`lib/calls/ai-agents.ts`). Con el cliente de SERVICIO: quien llama
 * ya miró el permiso y el negocio sale de la sesión. NUNCA lanza: si algo falla, el botón no aparece.
 *
 * Con `canCreate` (`agents.edit`), los dos agentes analizadores que falten se crean primero (apagados, 00536).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { CategoryRow } from "@/lib/scheduling/categories";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { AREA_ANALYZER_AGENT } from "./area-analyzers";
import { areaAnalyzersMissing, ensureAreaAnalyzerAgents } from "./area-analyzer-agents";
import { loadCallProfiles } from "./profiles-load";
import { resolveCallTaskSettings } from "./task-settings";
import { callsAiAgents, type CallsAiAgent } from "./ai-agents";

export async function loadCallsAiAgents(
  service: SupabaseClient<Database>,
  workspaceId: string,
  backgroundSettings: unknown,
  categories: CategoryRow[],
  opts: { canCreate: boolean },
): Promise<CallsAiAgent[] | null> {
  try {
    const agentTypes = Object.values(AREA_ANALYZER_AGENT) as string[];
    const readAgents = async () => {
      const { data, error } = await service.from("agents").select("id, name, type").eq("workspace_id", workspaceId).in("type", agentTypes).is("deleted_at", null);
      if (error) throw new Error(error.message);
      return data ?? [];
    };
    const [firstRead, profiles] = await Promise.all([readAgents(), loadCallProfiles(service, workspaceId)]);
    let agents = firstRead;
    if (opts.canCreate && areaAnalyzersMissing(agents).length > 0) {
      const connected = await listConnectedAiProviders(workspaceId, service).catch(() => []);
      const created = await ensureAreaAnalyzerAgents(service, workspaceId, agents, connected);
      if (created && created.length > 0) agents = await readAgents();
    }
    const classification = resolveCallTaskSettings(backgroundSettings).call_classification;
    const byId = new Map(categories.map((c) => [c.id, c]));
    const areaOf = (categoryId: string) => {
      const c = byId.get(categoryId);
      return c ? (c.parent_id ?? c.id) : null;
    };
    const analyzers = Object.entries(AREA_ANALYZER_AGENT).flatMap(([areaKey, agentType]) => {
      const area = categories.find((c) => c.parent_id === null && c.system_key === areaKey && !c.archived_at);
      if (!area) return [];
      const mine = profiles.filter((p) => areaOf(p.categoryId) === area.id);
      const agent = agents.find((a) => a.type === agentType);
      return [{ areaKey, areaName: area.name, agentId: agent?.id ?? null, agentName: agent?.name ?? null, profiles: { auto: mine.filter((p) => p.mode === "auto").length, manual: mine.filter((p) => p.mode === "manual").length } }];
    });
    return callsAiAgents({ classification: { mode: classification.mode, activeRules: classification.rules.filter((r) => r.on).length }, analyzers });
  } catch (err) {
    console.error("[llamadas] no pude leer los agentes de IA:", err instanceof Error ? err.message : "error");
    return null;
  }
}
