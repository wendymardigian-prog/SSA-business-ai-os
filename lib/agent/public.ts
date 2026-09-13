import { getAgentType } from "./agent-types";

/**
 * Lo que cualquier miembro puede leer de un agente con su propio cliente.
 *
 * Las columnas de topes de gasto no tienen privilegio de lectura para el rol
 * authenticated (00060): un select("*") falla. Toda consulta del cliente de un
 * usuario sobre agents o agent_runs lista columnas de estas constantes.
 *
 * Sin dependencias de servidor: lo importan paginas y componentes.
 */

export const AGENT_PUBLIC_COLUMNS = "id, name, type, is_enabled, enabled_channel_ids, deleted_at" as const;

/** Columnas de agent_runs sin tokens ni costo (00060). */
export const AGENT_RUN_PUBLIC_COLUMNS =
  "id, workspace_id, source, agent_id, prompt_version, conversation_id, thread_id, contact_id, channel_id, trigger, status, status_detail, provider, model, latency_ms, step_count, error, created_at, completed_at" as const;

/** Las columnas que NUNCA pueden aparecer en una consulta del cliente de un usuario. */
export const AGENT_RUN_COST_COLUMNS = [
  "input_tokens",
  "output_tokens",
  "cached_tokens",
  "embedding_tokens",
  "cost_usd",
  "pricing_id",
] as const;

export interface PublicAgent {
  id: string;
  name: string;
  type: string;
  is_enabled: boolean;
  enabled_channel_ids: string[];
  deleted_at: string | null;
}

export type ChannelAgentReason = "no_agent" | "agent_off" | "channel_off";

export interface ChannelAgentInfo {
  /** Si el toggle de una conversacion de este canal se puede operar. */
  available: boolean;
  reason: ChannelAgentReason | null;
  agentName: string | null;
  /** Explicacion lista para mostrar cuando no esta disponible. */
  message: string | null;
}

/**
 * Para cada canal, si el agente lo atiende (interruptor maestro) y por que no.
 * Es lo que decide si el toggle de la bandeja esta bloqueado en "off".
 */
export function channelAgentInfo(
  agents: PublicAgent[],
  channel: { id: string; label: string },
): ChannelAgentInfo {
  const live = agents.filter((a) => !a.deleted_at && getAgentType(a.type)?.conversational);
  if (live.length === 0) {
    return {
      available: false,
      reason: "no_agent",
      agentName: null,
      message: "Todavia no hay un agente de IA. Se crea en Agentes.",
    };
  }
  const forChannel = live.find((a) => a.enabled_channel_ids.includes(channel.id));
  if (!forChannel) {
    return {
      available: false,
      reason: "channel_off",
      agentName: live[0].name,
      message: `El agente esta apagado para ${channel.label}; activalo en Agentes para poder encenderlo por conversacion.`,
    };
  }
  if (!forChannel.is_enabled) {
    return {
      available: false,
      reason: "agent_off",
      agentName: forChannel.name,
      message: `"${forChannel.name}" esta apagado. Se enciende desde Agentes.`,
    };
  }
  return { available: true, reason: null, agentName: forChannel.name, message: null };
}
