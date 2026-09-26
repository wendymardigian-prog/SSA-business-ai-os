import type { AgentConfig } from "./config";
import type { Guardrails, OutputFormat } from "./schemas";
import type { Json } from "@/lib/types/database";
import type { DatePreset } from "@/lib/dates";
import type { ScreenTool } from "./tools/config";
import type { ToolConfigOption, ToolOptionSource } from "./tools/types";

/**
 * Lo que la pantalla de Agentes recibe del servidor, ya aplanado. Sin
 * dependencias de servidor: lo importan los componentes cliente.
 */

/** Filtros de la pestana Runs, ya validados contra lo que existe. */
export interface RunFilters {
  page: number;
  datePreset: DatePreset | "";
  dateFrom: string;
  dateTo: string;
  /** id de un agente, "todos" o "sin-agente". */
  agente: string;
  canal: string;
  contacto: string;
  conversacion: string;
  q: string;
  resultado: string;
  modelo: string;
  accion: string;
  costoMin: number | null;
  costoMax: number | null;
}

export interface RunStepRow {
  id: string;
  index: number;
  kind: string;
  name: string | null;
  input: Json | null;
  output: Json | null;
  kbChunks: Array<{ id: string; label: string | null }>;
  auditLogId: string | null;
  durationMs: number | null;
  error: string | null;
}

export interface RunRow {
  id: string;
  createdAt: string;
  completedAt: string | null;
  source: string;
  trigger: string;
  status: string;
  statusDetail: string | null;
  agentId: string | null;
  agentName: string | null;
  promptVersion: number | null;
  conversationId: string | null;
  contactId: string | null;
  contactName: string | null;
  channelId: string | null;
  channelLabel: string | null;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  stepCount: number;
  error: string | null;
  /** Solo Owner/Admin. Un Member recibe null. */
  cost: { usd: number | null; inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null; embeddingTokens: number | null } | null;
  steps: RunStepRow[];
}

export interface RunsTabData {
  filters: RunFilters;
  rows: RunRow[];
  total: number;
  pageSize: number;
  /** Si el workspace tiene algun run (para distinguir "vacio" de "el filtro no encontro"). */
  anyRuns: boolean;
  options: {
    agents: Array<{ id: string; name: string }>;
    channels: Array<{ id: string; label: string }>;
    models: string[];
    tools: Array<{ name: string; label: string }>;
  };
  showCost: boolean;
}

export interface ActionFilters {
  page: number;
  accion: string;
  datePreset: DatePreset | "";
  dateFrom: string;
  dateTo: string;
  /** id de un agente o "todos". */
  agente: string;
  canal: string;
  contacto: string;
  /** "", "si" o "no". */
  revertida: string;
}

export interface ActionRow {
  id: string;
  performedAt: string;
  action: string;
  actionLabel: string;
  agentId: string | null;
  agentName: string | null;
  contactId: string | null;
  contactName: string | null;
  conversationId: string | null;
  channelId: string | null;
  channelLabel: string | null;
  runId: string | null;
  origin: string | null;
  changes: Array<{ field: string; before: string; after: string }>;
  reason: string | null;
  revertedAt: string | null;
  revertible: boolean;
}

export interface ActionsTabData {
  filters: ActionFilters;
  rows: ActionRow[];
  total: number;
  pageSize: number;
  anyActions: boolean;
  options: {
    agents: Array<{ id: string; name: string }>;
    channels: Array<{ id: string; label: string }>;
  };
}

export interface CostFilters {
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
}

export interface CostReport {
  totals: {
    runs: number;
    costUsd: number;
    conversations: number;
    escalations: number;
    responded: number;
    missingPricing: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    embeddingTokens: number;
  };
  bySource: Array<{ source: string; label: string; runs: number; costUsd: number }>;
  byAgent: Array<{ agentId: string | null; name: string; runs: number; costUsd: number }>;
  byModel: Array<{ provider: string | null; model: string; runs: number; costUsd: number; inputTokens: number; outputTokens: number; missingPricing: number }>;
  topConversations: Array<{ conversationId: string; contactId: string | null; contactName: string | null; runs: number; costUsd: number }>;
  /**
   * Modo borrador (Bloque 2c): cuantos turnos dejaron borrador, cuanto se gasto
   * en los que se descartaron (lo que cuesta la desconfianza) y cuantos se
   * enviaron sin editar (el dato para pasar a envio directo).
   */
  drafts: { drafted: number; discarded: number; discardedCostUsd: number; sent: number; sentUnedited: number };
}

export interface CostsTabData {
  filters: CostFilters;
  rangeLabel: string;
  report: CostReport;
  averages: { perRun: number | null; perConversation: number | null; perEscalation: number | null; escalationRatePct: number | null };
  limits: {
    agentDailyUsd: number | null;
    agentDailyAction: "notify" | "disable";
    agentMonthlyUsd: number | null;
    agentMonthlyAction: "notify" | "disable";
    workspaceDailyUsd: number | null;
    workspaceMonthlyUsd: number | null;
  };
  pricing: Array<{ id: string; provider: string; model: string; inputPerMtok: number; outputPerMtok: number; cachedInputPerMtok: number; validFrom: string; note: string | null }>;
  /** Solo Owner edita la tabla de precios. */
  canEditPricing: boolean;
}

/** Cabecera del detalle (solo Owner/Admin): runs de hoy, gasto del mes, % de derivaciones. */
export interface HeaderKpis {
  runsToday: number;
  monthCostUsd: number | null;
  escalationRatePct: number | null;
  missingPricing: number;
}

/**
 * Pestana Etiquetas (Bloque 2d-A): el efecto de cada etiqueta sobre el agente.
 * Solo Owner/Admin. En 2d-B suma las sugeridas y las reglas de boton.
 */
export interface TagsTabData {
  tags: Array<{
    id: string;
    name: string;
    color: string | null;
    disablesAgent: boolean;
    assignsTo: string | null;
    /** Cuantos contactos la tienen hoy: prender el efecto los afecta ya. */
    contactCount: number;
  }>;
  members: Array<{ userId: string; label: string }>;
}

export interface AgentScreenData {
  /** Quien mira: decide pestanas y columnas. */
  viewer: { isAdmin: boolean };
  /** Solo cuando la pestana activa es Etiquetas (y solo Owner/Admin). */
  tags?: TagsTabData;
  /** Solo Owner/Admin. */
  kpis?: HeaderKpis;
  /** Solo cuando la pestana activa es Costos (y solo Owner/Admin). */
  costs?: CostsTabData;
  /** Solo cuando la pestana activa es Runs. */
  runs?: RunsTabData;
  /** Solo cuando la pestana activa es Acciones. */
  actions?: ActionsTabData;
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
    maxRepliesPerConversation: number | null;
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
    /** Modo por canal (00070). Sin entrada = envio directo. */
    channelModes: Record<string, "send" | "draft">;
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
    channelModes: agent.channelModes,
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
