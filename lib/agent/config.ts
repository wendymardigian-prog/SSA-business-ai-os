import type { SupabaseClient } from "@supabase/supabase-js";
import type { CostLimitAction, Database, KnowledgeFallback } from "@/lib/types/database";
import {
  guardrailsSchema,
  outputFormatSchema,
  parseWithDefaults,
  type Guardrails,
  type OutputFormat,
} from "./schemas";
import { getAgentType } from "./agent-types";

/**
 * La configuracion del agente, normalizada, y su estado efectivo.
 *
 * El estado efectivo NO se guarda en ninguna columna: se deriva cada vez de
 * las palancas (agente global + canal + toggle de la conversacion + pausa de
 * un flow). Guardar el resultado seria una segunda fuente de verdad que tarde
 * o temprano contradice a las palancas. Los guardarrailes, las automatizaciones
 * y el control humano se evaluan despues, en el despacho y en el turno.
 */

type Db = SupabaseClient<Database>;
type AgentRow = Database["public"]["Tables"]["agents"]["Row"];

export interface AgentConfig {
  id: string;
  workspaceId: string;
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
  /** La rafaga ignora entrantes mas viejos que esto (horas desde el turno). */
  burstMaxAgeHours: number;
  /** Cierre por inactividad y que hacer al cerrar (00067). */
  closeAfterInactiveHours: number;
  summaryOnClose: boolean;
  classifyOnClose: boolean;
  outputFormat: OutputFormat;
  allowedTools: string[];
  toolsConfig: Record<string, unknown>;
  guardrails: Guardrails;
  knowledgeEnabled: boolean;
  knowledgeTags: string[];
  knowledgeFallback: KnowledgeFallback;
  dailyCostLimitUsd: number | null;
  dailyCostLimitAction: CostLimitAction;
  monthlyCostLimitUsd: number | null;
  monthlyCostLimitAction: CostLimitAction;
  enabledChannelIds: string[];
  createdAt: string;
}

const num = (value: unknown): number | null =>
  value === null || value === undefined || value === "" ? null : Number(value);

/** Default de agents.burst_max_age_hours (00066), por si una fila vieja no lo trae. */
export const DEFAULT_BURST_MAX_AGE_HOURS = 6;

export function toAgentConfig(row: AgentRow): AgentConfig {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    type: row.type,
    isEnabled: row.is_enabled,
    systemPrompt: row.system_prompt ?? "",
    promptVersion: row.active_prompt_version,
    provider: row.provider,
    model: row.model,
    fallbackProvider: row.fallback_provider,
    fallbackModel: row.fallback_model,
    temperature: num(row.temperature),
    maxOutputTokens: row.max_output_tokens,
    modelTimeoutSeconds: row.model_timeout_seconds,
    bundleWindowSeconds: row.bundle_window_seconds,
    responseDelaySeconds: row.response_delay_seconds,
    maxWaitSeconds: row.max_wait_seconds,
    maxRepliesPerConversation: row.max_replies_per_conversation,
    burstMaxAgeHours: row.burst_max_age_hours ?? DEFAULT_BURST_MAX_AGE_HOURS,
    closeAfterInactiveHours: row.close_after_inactive_hours ?? 12,
    summaryOnClose: row.summary_on_close ?? true,
    classifyOnClose: row.classify_on_close ?? true,
    outputFormat: parseWithDefaults(outputFormatSchema, row.output_format),
    allowedTools: row.allowed_tools ?? [],
    toolsConfig:
      row.tools_config && typeof row.tools_config === "object" && !Array.isArray(row.tools_config)
        ? (row.tools_config as Record<string, unknown>)
        : {},
    guardrails: parseWithDefaults(guardrailsSchema, row.guardrails),
    knowledgeEnabled: row.knowledge_enabled,
    knowledgeTags: row.knowledge_tags ?? [],
    knowledgeFallback: row.knowledge_fallback,
    dailyCostLimitUsd: num(row.daily_cost_limit_usd),
    dailyCostLimitAction: row.daily_cost_limit_action,
    monthlyCostLimitUsd: num(row.monthly_cost_limit_usd),
    monthlyCostLimitAction: row.monthly_cost_limit_action,
    enabledChannelIds: row.enabled_channel_ids ?? [],
    createdAt: row.created_at,
  };
}

/**
 * Los agentes vivos del workspace. Con service role: lee tambien las columnas
 * de topes de gasto, que el cliente de un usuario no puede leer (00060).
 */
export async function loadWorkspaceAgents(service: Db, workspaceId: string): Promise<AgentConfig[]> {
  const { data, error } = await service
    .from("agents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[agent] no pude leer los agentes:", error.message);
    return [];
  }
  return (data ?? []).map(toAgentConfig);
}

export async function loadAgentById(service: Db, agentId: string): Promise<AgentConfig | null> {
  const { data, error } = await service
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[agent] no pude leer el agente:", error.message);
    return null;
  }
  return data ? toAgentConfig(data) : null;
}

export type AgentAvailability = (
  | { state: "active"; agent: AgentConfig }
  | { state: "no_agent" }
  | { state: "agent_off"; agent: AgentConfig }
  | { state: "channel_off"; agent: AgentConfig }
  | { state: "conversation_off"; agent: AgentConfig }
  | { state: "paused"; agent: AgentConfig; until: string }
) & {
  /** Si la conversacion esta en "heredar" (agent_enabled NULL): el maestro del canal decidio. */
  inherited: boolean;
};

/** Los tres estados del interruptor por conversacion (00066). */
export type ConversationAgentMode = "inherit" | "on" | "off";

export interface ConversationLevers {
  /** null = heredar del canal; true = forzado prendido; false = forzado apagado. */
  agent_enabled: boolean | null;
  agent_paused_until: string | null;
}

export function toAgentMode(value: boolean | null | undefined): ConversationAgentMode {
  return value === true ? "on" : value === false ? "off" : "inherit";
}

export function fromAgentMode(mode: ConversationAgentMode): boolean | null {
  return mode === "on" ? true : mode === "off" ? false : null;
}

/**
 * El agente que atiende un canal. Si hay varios que lo tienen encendido, el
 * mas viejo (la pantalla impide asignar un canal a dos agentes; esto es por si
 * alguien escribio en la base a mano).
 */
export function agentForChannel(agents: AgentConfig[], channelId: string): AgentConfig | null {
  return agents.find((a) => a.enabledChannelIds.includes(channelId)) ?? null;
}

export function isPaused(pausedUntil: string | null, now: Date): boolean {
  if (!pausedUntil) return false;
  if (pausedUntil === "infinity") return true;
  const until = new Date(pausedUntil).getTime();
  return Number.isNaN(until) ? false : until > now.getTime();
}

/**
 * Estado efectivo del agente en una conversacion. Pura. Es EL unico lugar que
 * combina las palancas; todo el que necesita saber si el agente atiende pasa
 * por aca (despacho, turno, primitivos del flow builder, bandeja).
 *
 * El interruptor por conversacion tiene tres estados (00066):
 *   - NULL (heredar): el maestro del canal decide. Es el default.
 *   - true (forzado prendido): igual que heredar con el maestro prendido; sin
 *     maestro tampoco atiende (no hay agente para ese canal). La diferencia con
 *     "heredar" es para el operador y para el despacho: alguien lo pidio
 *     explicitamente, asi que una abstencion deja rastro.
 *   - false (forzado apagado): no atiende aunque el maestro este prendido.
 *
 * El orden de los motivos es el que ve el operador: primero lo mas general
 * (no hay agente, esta apagado), despues el canal, despues la conversacion.
 */
export function resolveAgentState(args: {
  agents: AgentConfig[];
  channelId: string;
  conversation: ConversationLevers;
  now: Date;
}): AgentAvailability {
  const inherited = args.conversation.agent_enabled === null || args.conversation.agent_enabled === undefined;

  // Solo los tipos que conversan con leads: un agente de contenido o de
  // gestion (etapas futuras) nunca atiende una conversacion de la bandeja.
  const chatAgents = args.agents.filter((a) => getAgentType(a.type)?.conversational);
  if (chatAgents.length === 0) return { state: "no_agent", inherited };

  const forChannel = agentForChannel(chatAgents, args.channelId);
  if (!forChannel) {
    // Hay agente, pero ninguno atiende este canal. Se reporta el primero para
    // que el mensaje pueda nombrarlo.
    const first = chatAgents[0];
    return first.isEnabled
      ? { state: "channel_off", agent: first, inherited }
      : { state: "agent_off", agent: first, inherited };
  }
  if (!forChannel.isEnabled) return { state: "agent_off", agent: forChannel, inherited };
  if (args.conversation.agent_enabled === false) return { state: "conversation_off", agent: forChannel, inherited: false };
  if (isPaused(args.conversation.agent_paused_until, args.now)) {
    return { state: "paused", agent: forChannel, until: args.conversation.agent_paused_until as string, inherited };
  }
  return { state: "active", agent: forChannel, inherited };
}
