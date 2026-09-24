import type { AgentConfig } from "./config";
import type { Guardrails, OutputFormat } from "./schemas";
import type { ScreenTool } from "./tools/config";
import type { ToolConfigOption, ToolOptionSource } from "./tools/types";

/**
 * Lo que la pantalla de Agentes recibe del servidor, ya aplanado. Sin
 * dependencias de servidor: lo importan los componentes cliente.
 */

export interface AgentScreenData {
  agent: {
    id: string;
    name: string;
    type: string;
    isEnabled: boolean;
    systemPrompt: string;
    promptVersion: number | null;
    provider: string | null;
    model: string | null;
    fallbackProvider: string | null;
    fallbackModel: string | null;
    temperature: number | null;
    maxOutputTokens: number | null;
    modelTimeoutSeconds: number;
    bundleWindowSeconds: number;
    responseDelaySeconds: number;
    maxWaitSeconds: number | null;
    maxRepliesPerConversation: number;
    burstMaxAgeHours: number;
    closeAfterInactiveHours: number;
    summaryOnClose: boolean;
    classifyOnClose: boolean;
    outputFormat: OutputFormat;
    guardrails: Guardrails;
    knowledgeEnabled: boolean;
    knowledgeTags: string[];
    knowledgeFallback: "escalate" | "general";
    dailyCostLimitUsd: number | null;
    dailyCostLimitAction: "notify" | "disable";
    monthlyCostLimitUsd: number | null;
    monthlyCostLimitAction: "notify" | "disable";
    enabledChannelIds: string[];
    allowedTools: string[];
    toolsConfig: Record<string, unknown>;
  };
  /** Las herramientas del registro, ya planas para la pestana Herramientas. */
  tools: ScreenTool[];
  /** Opciones que dependen de la base, por nombre de fuente (tags, miembros). */
  toolOptionSources: Record<ToolOptionSource, ToolConfigOption[]>;
  versions: Array<{ version: number; systemPrompt: string; note: string | null; createdAt: string; authorLabel: string | null }>;
  /** Proveedores de texto con key activa. Lo unico que se puede elegir. */
  providers: Array<{ provider: string; label: string; defaultModel: string; models: string[] }>;
  /** Etiquetas del catalogo para nombrar un proveedor configurado que ya no esta conectado. */
  providerLabels: Record<string, string>;
  /** "proveedor/modelo" con precio cargado en model_pricing. */
  pricedModels: string[];
  channels: Array<{ id: string; label: string; platform: string; handle: string | null; isActive: boolean; takenBy: string | null }>;
  knowledgeDocs: Array<{ id: string; title: string; tags: string[]; internalOnly: boolean; status: string }>;
  /** Flows publicados con trigger por defecto sin la puerta "solo si el agente esta apagado". */
  flowsCapturingAll: Array<{ id: string; name: string }>;
  /** Si se guardan los entrantes de Zernio: sin eso el agente no tiene que leer (00053). */
  persistZernioInbound: boolean;
}

export function toScreenAgent(agent: AgentConfig): AgentScreenData["agent"] {
  return {
    id: agent.id,
    name: agent.name,
    type: agent.type,
    isEnabled: agent.isEnabled,
    systemPrompt: agent.systemPrompt,
    promptVersion: agent.promptVersion,
    provider: agent.provider,
    model: agent.model,
    fallbackProvider: agent.fallbackProvider,
    fallbackModel: agent.fallbackModel,
    temperature: agent.temperature,
    maxOutputTokens: agent.maxOutputTokens,
    modelTimeoutSeconds: agent.modelTimeoutSeconds,
    bundleWindowSeconds: agent.bundleWindowSeconds,
    responseDelaySeconds: agent.responseDelaySeconds,
    maxWaitSeconds: agent.maxWaitSeconds,
    maxRepliesPerConversation: agent.maxRepliesPerConversation,
    burstMaxAgeHours: agent.burstMaxAgeHours,
    closeAfterInactiveHours: agent.closeAfterInactiveHours,
    summaryOnClose: agent.summaryOnClose,
    classifyOnClose: agent.classifyOnClose,
    outputFormat: agent.outputFormat,
    guardrails: agent.guardrails,
    knowledgeEnabled: agent.knowledgeEnabled,
    knowledgeTags: agent.knowledgeTags,
    knowledgeFallback: agent.knowledgeFallback,
    dailyCostLimitUsd: agent.dailyCostLimitUsd,
    dailyCostLimitAction: agent.dailyCostLimitAction,
    monthlyCostLimitUsd: agent.monthlyCostLimitUsd,
    monthlyCostLimitAction: agent.monthlyCostLimitAction,
    enabledChannelIds: agent.enabledChannelIds,
    allowedTools: agent.allowedTools,
    toolsConfig: agent.toolsConfig,
  };
}

/** Cuantos documentos lee el agente con la configuracion actual. Pura. */
export function countIncludedDocuments(
  docs: AgentScreenData["knowledgeDocs"],
  tags: string[],
): { included: number; internalExcluded: number; outsideTags: number } {
  let included = 0;
  let internalExcluded = 0;
  let outsideTags = 0;
  for (const doc of docs) {
    if (doc.internalOnly) {
      internalExcluded++;
      continue;
    }
    if (tags.length > 0 && !doc.tags.some((t) => tags.includes(t))) {
      outsideTags++;
      continue;
    }
    included++;
  }
  return { included, internalExcluded, outsideTags };
}
