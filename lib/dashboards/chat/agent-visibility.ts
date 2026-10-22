/**
 * Cuando se muestra la seccion "El agente" del dashboard de Chat (O).
 *
 * Antes se dibujaba SIEMPRE, y despues invitaba a encender el agente apenas
 * habia una IA conectada. Ahora la seccion existe solo si el agente de verdad
 * esta (o estuvo) actuando en conversaciones:
 *
 *   | estado                                                        | seccion          |
 *   |---------------------------------------------------------------|------------------|
 *   | el agente nunca actuo y no hay uno encendido con canales + IA | oculta           |
 *   | hay un agente encendido, con canales, que puede responder     | completa         |
 *   | el agente actuo alguna vez y ahora no puede responder         | completa + aviso |
 *   | encendido con canales pero sin poder responder (IA caida)     | completa + aviso |
 *
 * "Actuo alguna vez" = existe una corrida del agente (`agent_runs.source =
 * 'agent'`): quien llama la consulta con el cliente de servicio, asi la
 * respuesta es la misma para todos.
 *
 * IMPORTANTE: esto solo decide que se VE. Los agentes y su configuracion no se
 * tocan nunca; reconectar la IA o encender un agente hace que la seccion vuelva
 * sola. Con "completa + aviso" los datos historicos siguen a la vista: pasaron.
 *
 * Puro.
 */

import { agentAvailability } from "@/lib/agent/availability";

export type AgentSectionVisibility = "hidden" | "full" | "full-with-warning";

export interface ChatAgentForVisibility {
  isEnabled: boolean;
  provider: string | null;
  model: string | null;
  /** Cuantos canales tiene encendidos: un agente prendido sin canales no conversa con nadie. */
  channelCount: number;
}

export interface AgentVisibilityResult {
  mode: AgentSectionVisibility;
  /** El aviso de arriba de la seccion (solo con `full-with-warning`). */
  warning: string | null;
}

const HIDDEN: AgentVisibilityResult = { mode: "hidden", warning: null };

/** `agents`: SOLO los agentes que conversan (el copywriter no cuenta). */
export function agentSectionVisibility(args: {
  agents: readonly ChatAgentForVisibility[];
  connectedProviders: readonly string[];
  /** Si el agente actuo alguna vez en una conversacion (hay corridas con `source = 'agent'`). */
  everActed: boolean;
}): AgentVisibilityResult {
  const working = args.agents.filter((a) => a.isEnabled && a.channelCount > 0);
  const states = working.map((a) =>
    agentAvailability({ isEnabled: true, provider: a.provider, model: a.model, conversational: true, connectedProviders: args.connectedProviders }),
  );
  if (states.some((s) => s.state === "active")) return { mode: "full", warning: null };

  const noneConnected = args.connectedProviders.length === 0;
  // Sin historia, una IA desconectada o un agente que nunca arranco no merecen una seccion: no hay nada que contar.
  if (!args.everActed && (noneConnected || working.length === 0)) return HIDDEN;
  if (working.length === 0) {
    // Actuo antes y hoy esta apagado: los numeros del periodo siguen siendo reales, sin aviso.
    return noneConnected
      ? { mode: "full-with-warning", warning: "No hay ninguna IA conectada: el agente no está respondiendo. Los números de abajo son de cuando sí lo hacía." }
      : { mode: "full", warning: null };
  }

  return {
    mode: "full-with-warning",
    warning: noneConnected
      ? "No hay ninguna IA conectada: el agente no está respondiendo. Los números de abajo son de cuando sí lo hacía."
      : "La IA de los agentes encendidos no está conectada: no están respondiendo. Los números de abajo son de cuando sí lo hacían.",
  };
}
