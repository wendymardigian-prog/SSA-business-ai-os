import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { loadWorkspaceAgents, type AgentConfig } from "@/lib/agent/config";
import { getAgentType } from "@/lib/agent/agent-types";
import { getAgentTool } from "@/lib/agent/tools/index";

type Db = SupabaseClient<Database>;

/**
 * Como tiene cada agente el Resumen y la Clasificación al cierre: lo que de
 * verdad decide si esas dos tareas corren y con qué límites. Es lo que muestra
 * su pestaña Configuración (antes mostraba un selector de modo que nadie leía).
 *
 * Mismas reglas que `summarizeConversationOnClose` (lib/agent/summary.ts):
 * cada parte de la clasificación depende de su herramienta y de la
 * configuración de esa herramienta, con sus defaults.
 */
export interface AgentCloseSettings {
  agentId: string;
  name: string;
  isEnabled: boolean;
  summaryOnClose: boolean;
  classifyOnClose: boolean;
  closeAfterInactiveHours: number;
  tags: { enabled: boolean; allowedNames: string[]; canRemove: boolean };
  temperature: { enabled: boolean; canLower: boolean };
  followup: { enabled: boolean; maxDaysAhead: number; canOverrideManual: boolean };
}

export interface TagInfo {
  name: string;
  /** Una etiqueta con efecto (00073) nunca se le ofrece al agente. */
  hasEffect: boolean;
}

function toolConfig<T>(agent: AgentConfig, tool: string): T | null {
  const def = getAgentTool(tool);
  if (!def || !agent.allowedTools.includes(tool)) return null;
  const parsed = def.configSchema.safeParse(agent.toolsConfig[tool] ?? {});
  return parsed.success ? (parsed.data as T) : null;
}

/** Puro: la configuración de un agente, con los nombres de sus etiquetas permitidas. */
export function closeSettingsFor(agent: AgentConfig, tagsById: Map<string, TagInfo>): AgentCloseSettings {
  const tag = toolConfig<{ allowedTagIds: string[]; canRemove: boolean }>(agent, "etiquetar_contacto");
  const temp = toolConfig<{ canLower: boolean }>(agent, "cambiar_temperatura");
  const follow = toolConfig<{ maxDaysAhead: number; canOverrideManual: boolean }>(agent, "programar_seguimiento");
  const allowedNames = (tag?.allowedTagIds ?? [])
    .map((id) => tagsById.get(id))
    .filter((t): t is TagInfo => Boolean(t) && !t!.hasEffect)
    .map((t) => t.name)
    .sort((a, b) => a.localeCompare(b, "es"));
  return {
    agentId: agent.id,
    name: agent.name,
    isEnabled: agent.isEnabled,
    summaryOnClose: agent.summaryOnClose,
    classifyOnClose: agent.classifyOnClose,
    closeAfterInactiveHours: agent.closeAfterInactiveHours,
    tags: { enabled: tag !== null, allowedNames, canRemove: tag?.canRemove ?? false },
    temperature: { enabled: temp !== null, canLower: temp?.canLower ?? false },
    followup: { enabled: follow !== null, maxDaysAhead: follow?.maxDaysAhead ?? 0, canOverrideManual: follow?.canOverrideManual ?? false },
  };
}

/** Los agentes que atienden conversaciones (el copywriter no cierra nada), con su configuración de cierre. */
export async function loadAgentCloseSettings(service: Db, workspaceId: string): Promise<AgentCloseSettings[]> {
  const [agents, { data: tags, error }] = await Promise.all([
    loadWorkspaceAgents(service, workspaceId),
    service.from("tags").select("id, name, disables_agent, assigns_to").eq("workspace_id", workspaceId),
  ]);
  if (error) console.error("[ai-tasks] no pude leer las etiquetas para la configuracion de cierre:", error.message);
  const tagsById = new Map(
    (tags ?? []).map((t) => [t.id, { name: t.name, hasEffect: Boolean(t.disables_agent) || Boolean(t.assigns_to) }]),
  );
  return agents.filter((a) => getAgentType(a.type)?.conversational).map((a) => closeSettingsFor(a, tagsById));
}
