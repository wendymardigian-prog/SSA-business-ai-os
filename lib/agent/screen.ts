import type { AgentConfig } from "./config";
import type { WorkspaceSpendSettings } from "@/lib/ai/spend-settings";
import type { Guardrails, OutputFormat } from "./schemas";
import type { Json } from "@/lib/types/database";
import type { DatePreset } from "@/lib/dates";
import type { ScreenSkill, ScreenTool } from "./tools/config";
import type { ToolConfigOption, ToolOptionSource } from "./tools/types";

/**
 * Lo que la pantalla de Agentes recibe del servidor, ya aplanado. Sin
 * dependencias de servidor: lo importan los componentes cliente.
 */

/** Orden de la tabla de Corridas (Bloque Agentes IA). "recientes" es el default. */
export const RUN_ORDERS = ["recientes", "antiguas", "caras", "baratas", "lentas", "rapidas"] as const;
export type RunOrder = (typeof RUN_ORDERS)[number];

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
  /** Una regla de respuesta (su id), o "default" para la accion por defecto. */
  regla: string;
  /** `external_cooldown`, `already_answered`, `rule`, `provider_unavailable`. */
  detalle: string;
  costoMin: number | null;
  costoMax: number | null;
  /** El `source` de agent_runs (Bloque R, R2). Vacio = cualquiera. */
  origen: string;
  /** Atajo "Sin precio" (R2): cost_usd NULL con tokens > 0. Solo con permiso de costo. */
  sinPrecio: boolean;
  /** Atajo "Más lentas de 30 s" (R2). */
  masLentas: boolean;
  /**
   * Orden de la tabla (Bloque Agentes IA). "caras"/"baratas" solo valen con
   * permiso de costo; sin el, se cae a "recientes". Reemplaza al viejo
   * `masCaras`: el atajo "Más caras" ahora pone `orden=caras` directo.
   */
  orden: RunOrder;
  /**
   * : quién la disparó. Vacío = cualquiera; un id de persona; o
   * `RUN_PERSON_SYSTEM` para las que disparó el sistema (sin persona).
   */
  persona?: string;
  /** : solo las que dejaron al menos una aprobación rechazada (00413). */
  rechazadas?: boolean;
}

/** Valor del filtro de persona para las ejecuciones sin persona (las disparó el sistema). */
export const RUN_PERSON_SYSTEM = "sistema";

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
  /** Para saber si el contenido se purgo por retencion (R4): mas de 12 meses con input/output null. */
  createdAt: string;
}

export interface RunRow {
  id: string;
  createdAt: string;
  completedAt: string | null;
  source: string;
  trigger: string;
  threadId: string | null;
  status: string;
  statusDetail: string | null;
  routing: Record<string, unknown> | null;
  intent: Record<string, unknown> | null;
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
  /**  (00413): quién la disparó (null = el sistema) y su nombre para mostrar. */
  triggeredBy?: string | null;
  personName?: string | null;
  /** Dejó al menos una propuesta rechazada o un borrador descartado con motivo. */
  hasRejectedApproval?: boolean;
  /** Solo Owner/Admin. Un Member recibe null. */
  cost: { usd: number | null; inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null; embeddingTokens: number | null } | null;
  steps: RunStepRow[];
}

/** Las opciones de filtro de la pantalla global de Corridas (R1). */
export interface RunsScreenOptions {
  agents: Array<{ id: string; name: string }>;
  channels: Array<{ id: string; label: string }>;
  models: string[];
  tools: Array<{ name: string; label: string }>;
  sources: string[];
  rules: Array<{ value: string; label: string }>;
  /** : las personas del negocio, para el filtro «Persona». */
  people?: Array<{ id: string; name: string }>;
}

/**
 * Lo que necesita `<RunsScreen>` (Bloque Agentes IA): la pestaña Runs de un
 * agente o de una tarea embebe la misma pantalla que Corridas, con el filtro
 * de ese agente/tarea ya puesto y sin salir de las pestañas (reemplaza el
 * redirect viejo, D8).
 */
export interface RunsTabData {
  rows: RunRow[];
  total: number;
  pageSize: number;
  filters: RunFilters;
  showCost: boolean;
  isAdmin: boolean;
  /** `data.export`: ofrece «Exportar CSV». */
  canExport?: boolean;
  options: RunsScreenOptions;
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
    /** Los topes del workspace: se editan en la tarjeta "Topes y avisos". */
    workspace: WorkspaceSpendSettings;
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
  /** `isAdmin`: puede configurar el agente (`agents.edit`). `permissionKeys`: lo que decide las pestañas. */
  viewer: { isAdmin: boolean; permissionKeys?: string[] };
  /** Solo cuando la pestana activa es Etiquetas (y solo Owner/Admin). */
  tags?: TagsTabData;
  /**
   * Solo Owner/Admin. Es una PROMESA: la pagina no la espera, la vista la
   * muestra cuando llega (el reporte del mes es lo mas pesado de la cabecera).
   */
  kpis?: Promise<HeaderKpis>;
  /** Solo cuando la pestana activa es Costos (y solo Owner/Admin). */
  costs?: CostsTabData;
  /** Solo cuando la pestana activa es Runs. */
  runs?: RunsTabData;
  /** Solo cuando la pestana activa es Acciones. */
  actions?: ActionsTabData;
  /**
   * Lo propio del copywriter (E3). Solo viene cuando el agente es de ese
   * tipo: su configuracion no encaja en la del agente de conversacion y
   * mezclarlas obligaria a que cada campo nuevo pasara por el esquema del
   * otro.
   */
  copywriter?: {
    /** El jsonb crudo: voz, limites y el interruptor. */
    config: unknown;
    /** El respaldo de antes de que existiera el agente. */
    workspaceSettings: unknown;
    /** Las etiquetas que existen en la base de conocimiento. */
    availableTags: string[];
  };
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
    /** Documentos y carpetas (00443) a los que llega (con las etiquetas: las tres vacías = toda la base). */
    knowledgeDocumentIds: string[];
    knowledgeFolderIds: string[];
    knowledgeFallback: "escalate" | "general";
    dailyCostLimitUsd: number | null;
    dailyCostLimitAction: "notify" | "disable";
    monthlyCostLimitUsd: number | null;
    monthlyCostLimitAction: "notify" | "disable";
    enabledChannelIds: string[];
    /** Modo por canal (00070). Sin entrada = envio directo. */
    channelModes: Record<string, "send" | "draft" | "rules">;
    /** Reglas de respuesta y su acción por defecto (F10). */
    responseRules: import("./rules/evaluate").Rule[];
    responseRulesDefault: "send" | "draft" | "skip";
    externalReplyCooldownMinutes: number;
    allowedTools: string[];
    toolsConfig: Record<string, unknown>;
    /** En borrador, las acciones esperan aprobación (00441). */
    actionsNeedApproval: boolean;
    /** Ejemplos automáticos y umbral de reglas (00441). */
    learning: import("@/lib/ai-learning/settings").LearningSettings;
    /** Cerrar con «Fuente: documento, pág. N» al usar Conocimiento (00443). */
    citeSources: boolean;
  };
  /** Las herramientas del registro, ya planas para la pestana Herramientas. */
  tools: ScreenTool[];
  /** Las habilidades: grupos de herramientas que se prenden juntas (Etapa 4). */
  skills: ScreenSkill[];
  /** Opciones que dependen de la base, por nombre de fuente (tags, miembros). */
  toolOptionSources: Record<ToolOptionSource, ToolConfigOption[]>;
  versions: Array<{
    version: number;
    systemPrompt: string;
    note: string | null;
    createdAt: string;
    authorLabel: string | null;
    /** Qué cambió (00408): el texto, las reglas aprendidas o una vuelta atrás. */
    changeKind?: "prompt" | "learned_rules" | "restore";
    /** Las reglas aprendidas de esa versión. */
    learnedRules?: Array<{ id: string; text: string }>;
  }>;
  /** Reglas aprendidas del agente: propuestas, activas y retiradas. Solo en Configuración y con agents.edit. */
  learnedRules?: Array<{
    id: string;
    reasonKey: string;
    text: string;
    status: "proposed" | "active" | "discarded" | "retired";
    evidence: string[];
    rejections: number;
    proposedAt: string;
    decidedAt: string | null;
    decidedByLabel: string | null;
  }>;
  /** Las herramientas de la capa propia que el asistente puede ofrecer y cuáles están habilitadas. */
  assistantTools?: {
    all: Array<{ key: string; label: string; description: string; access: "read" | "write"; permission: string }>;
    enabled: string[];
  };
  /** Proveedores de texto con key activa. Lo unico que se puede elegir. */
  providers: Array<{ provider: string; label: string; defaultModel: string; models: string[] }>;
  /** Etiquetas del catalogo para nombrar un proveedor configurado que ya no esta conectado. */
  providerLabels: Record<string, string>;
  /** "proveedor/modelo" con precio cargado en model_pricing. */
  pricedModels: string[];
  channels: Array<{ id: string; label: string; platform: string; handle: string | null; isActive: boolean; takenBy: string | null }>;
  knowledgeDocs: Array<{ id: string; title: string; tags: string[]; internalOnly: boolean; status: string; folderId?: string | null }>;
  /** Carpetas vivas de la base (00412, ). */
  knowledgeFolders?: Array<{ id: string; name: string }>;
  /** Flows publicados con trigger por defecto sin la puerta "solo si el agente esta apagado". */
  flowsCapturingAll: Array<{ id: string; name: string }>;
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
    knowledgeDocumentIds: agent.knowledgeDocumentIds,
    knowledgeFolderIds: agent.knowledgeFolderIds,
    knowledgeFallback: agent.knowledgeFallback,
    dailyCostLimitUsd: agent.dailyCostLimitUsd,
    dailyCostLimitAction: agent.dailyCostLimitAction,
    monthlyCostLimitUsd: agent.monthlyCostLimitUsd,
    monthlyCostLimitAction: agent.monthlyCostLimitAction,
    enabledChannelIds: agent.enabledChannelIds,
    channelModes: agent.channelModes,
    responseRules: agent.responseRules,
    responseRulesDefault: agent.responseRulesDefault,
    externalReplyCooldownMinutes: agent.externalReplyCooldownMinutes,
    allowedTools: agent.allowedTools,
    toolsConfig: agent.toolsConfig,
    actionsNeedApproval: agent.actionsNeedApproval,
    learning: agent.learning,
    citeSources: agent.citeSources,
  };
}

/**
 * Cuantos documentos lee el agente con la configuracion actual. Pura. Mismo
 * criterio que `match_knowledge_chunks_scoped` (00443): con etiquetas,
 * documentos y carpetas vacíos, toda la base; si no, lo que coincida con alguno.
 * `outsideTags` cuenta lo que queda fuera del alcance (por etiqueta, documento o carpeta).
 */
export function countIncludedDocuments(
  docs: AgentScreenData["knowledgeDocs"],
  tags: string[],
  documentIds: string[] = [],
  folderIds: string[] = [],
): { included: number; internalExcluded: number; outsideTags: number } {
  let included = 0;
  let internalExcluded = 0;
  let outsideTags = 0;
  const all = tags.length === 0 && documentIds.length === 0 && folderIds.length === 0;
  for (const doc of docs) {
    if (doc.internalOnly) {
      internalExcluded++;
      continue;
    }
    const inScope =
      all ||
      doc.tags.some((t) => tags.includes(t)) ||
      documentIds.includes(doc.id) ||
      (doc.folderId != null && folderIds.includes(doc.folderId));
    if (!inScope) {
      outsideTags++;
      continue;
    }
    included++;
  }
  return { included, internalExcluded, outsideTags };
}
