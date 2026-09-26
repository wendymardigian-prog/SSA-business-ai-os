import { getAgentType } from "./agent-types";
import type { AgentChannelMode } from "@/lib/types/database";

/**
 * Lo que cualquier miembro puede leer de un agente con su propio cliente.
 *
 * Las columnas de topes de gasto no tienen privilegio de lectura para el rol
 * authenticated (00060): un select("*") falla. Toda consulta del cliente de un
 * usuario sobre agents o agent_runs lista columnas de estas constantes.
 *
 * Sin dependencias de servidor: lo importan paginas y componentes.
 */

export const AGENT_PUBLIC_COLUMNS = "id, name, type, is_enabled, enabled_channel_ids, channel_modes, deleted_at" as const;

/** Columnas de agent_runs sin tokens ni costo (00060). */
export const AGENT_RUN_PUBLIC_COLUMNS =
  "id, workspace_id, source, agent_id, prompt_version, conversation_id, thread_id, contact_id, channel_id, trigger, status, status_detail, routing, provider, model, latency_ms, step_count, error, created_at, completed_at" as const;

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
  /** { channel_id: "send" | "draft" } (00070). Opcional para filas armadas a mano. */
  channel_modes?: unknown;
  deleted_at: string | null;
}

export type ChannelAgentReason = "no_agent" | "agent_off" | "channel_off";

export interface ChannelAgentInfo {
  /** Si el agente atiende este canal (maestro prendido y agente encendido). */
  available: boolean;
  reason: ChannelAgentReason | null;
  agentName: string | null;
  /** Nombre del canal para las frases de la bandeja ("atiende Instagram"). */
  channelLabel: string;
  /** Explicacion lista para mostrar cuando no esta disponible. */
  message: string | null;
  /**
   * Como entrega el agente en este canal (00070): "draft" deja borradores para
   * aprobar. Solo significa algo con available en true.
   */
  mode: AgentChannelMode;
}

/** El modo de un canal leido de la fila publica. Espejo de channelMode() de config.ts. */
export function publicChannelMode(agent: PublicAgent, channelId: string): AgentChannelMode {
  if (!agent.enabled_channel_ids.includes(channelId)) return "send";
  const modes = agent.channel_modes;
  if (!modes || typeof modes !== "object" || Array.isArray(modes)) return "send";
  return (modes as Record<string, unknown>)[channelId] === "draft" ? "draft" : "send";
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
      channelLabel: channel.label,
      message: "Todavia no hay un agente de IA. Se crea en Agentes.",
      mode: "send",
    };
  }
  const forChannel = live.find((a) => a.enabled_channel_ids.includes(channel.id));
  if (!forChannel) {
    return {
      available: false,
      reason: "channel_off",
      agentName: live[0].name,
      channelLabel: channel.label,
      message: `El agente esta apagado para ${channel.label}; activalo en Agentes para poder encenderlo por conversacion.`,
      mode: "send",
    };
  }
  if (!forChannel.is_enabled) {
    return {
      available: false,
      reason: "agent_off",
      agentName: forChannel.name,
      channelLabel: channel.label,
      message: `"${forChannel.name}" esta apagado. Se enciende desde Agentes.`,
      mode: publicChannelMode(forChannel, channel.id),
    };
  }
  return {
    available: true,
    reason: null,
    agentName: forChannel.name,
    channelLabel: channel.label,
    message: null,
    mode: publicChannelMode(forChannel, channel.id),
  };
}
