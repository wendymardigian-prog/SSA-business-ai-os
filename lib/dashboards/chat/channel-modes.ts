/**
 * ¿Algun canal deja borradores?
 *
 * De eso depende que se muestre el aviso de arriba y que la tarjeta de
 * aprobacion tenga datos o explique como activarlo. El modo NO sale de la base
 * con una consulta propia: sale de `agents.channel_modes`, que la pantalla ya
 * lee con las columnas publicas del agente (`lib/agent/public.ts`).
 */

import { publicChannelMode, type PublicAgent } from "@/lib/agent/public";
import { getAgentType } from "@/lib/agent/agent-types";

export interface DraftChannelsInfo {
  /** Cuantos canales dejan borradores o deciden por reglas. */
  count: number;
  /** Los ids de esos canales, para nombrarlos en la tarjeta. */
  channelIds: string[];
  hasAny: boolean;
}

/**
 * Los canales en modo borrador o "segun reglas" de los agentes de conversacion.
 *
 * "Segun reglas" cuenta: una regla puede dejar un borrador, asi que la cola
 * puede tener trabajo igual.
 */
export function draftChannels(agents: PublicAgent[]): DraftChannelsInfo {
  const ids = new Set<string>();
  for (const agent of agents) {
    if (!getAgentType(agent.type)?.conversational) continue;
    for (const channelId of agent.enabled_channel_ids ?? []) {
      const mode = publicChannelMode(agent, channelId);
      if (mode === "draft" || mode === "rules") ids.add(channelId);
    }
  }
  const channelIds = [...ids];
  return { count: channelIds.length, channelIds, hasAny: channelIds.length > 0 };
}

/** Los nombres de los canales en modo borrador, para el subtitulo de la tarjeta. */
export function draftChannelLabels(
  info: DraftChannelsInfo,
  channels: Array<{ id: string; label: string }>,
): string {
  const byId = new Map(channels.map((c) => [c.id, c.label]));
  const names = info.channelIds.map((id) => byId.get(id)).filter((n): n is string => Boolean(n));
  if (names.length === 0) return "Ningún canal deja borradores";
  return `Canales en modo borrador: ${names.join(", ")}`;
}
