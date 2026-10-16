/**
 * Cuando se muestra la seccion "El agente" del dashboard de Chat (O).
 *
 * Antes se dibujaba SIEMPRE: en un negocio sin ninguna IA conectada y sin
 * agentes encendidos eran cinco tarjetas vacias de algo que no existe. Ahora
 * depende del estado real del sistema (la misma regla de disponibilidad que usan
 * Agentes IA, la bandeja y el despacho):
 *
 *   | estado                                                  | seccion          |
 *   |---------------------------------------------------------|------------------|
 *   | sin IA conectada y sin agentes encendidos               | oculta           |
 *   | hay IA, pero ningun agente de chat esta encendido       | invitacion       |
 *   | al menos un agente encendido que puede responder        | completa         |
 *   | agentes encendidos pero sin poder responder (IA caida)  | completa + aviso |
 *
 * IMPORTANTE: esto solo decide que se VE. Los agentes y su configuracion no se
 * tocan nunca; reconectar la IA o encender un agente hace que la seccion vuelva
 * sola. Con "completa + aviso" los datos historicos siguen a la vista: pasaron.
 *
 * Puro.
 */

import { agentAvailability } from "@/lib/agent/availability";

export type AgentSectionVisibility = "hidden" | "invite" | "full" | "full-with-warning";

export interface ChatAgentForVisibility {
  isEnabled: boolean;
  provider: string | null;
  model: string | null;
}

export interface AgentVisibilityResult {
  mode: AgentSectionVisibility;
  /** El aviso de arriba de la seccion (solo con `full-with-warning`). */
  warning: string | null;
}

/** `agents`: SOLO los agentes que conversan (el copywriter no cuenta). */
export function agentSectionVisibility(args: {
  agents: readonly ChatAgentForVisibility[];
  connectedProviders: readonly string[];
}): AgentVisibilityResult {
  const enabled = args.agents.filter((a) => a.isEnabled);

  if (enabled.length === 0) {
    // Nada encendido: con IA conectada se invita a encender uno; sin IA no hay nada que mostrar.
    return args.connectedProviders.length === 0 ? { mode: "hidden", warning: null } : { mode: "invite", warning: null };
  }

  const states = enabled.map((a) =>
    agentAvailability({ isEnabled: true, provider: a.provider, model: a.model, conversational: true, connectedProviders: args.connectedProviders }),
  );
  if (states.some((s) => s.state === "active")) return { mode: "full", warning: null };

  const noneConnected = args.connectedProviders.length === 0;
  return {
    mode: "full-with-warning",
    warning: noneConnected
      ? "No hay ninguna IA conectada: el agente no está respondiendo. Los números de abajo son de cuando sí lo hacía."
      : "La IA de los agentes encendidos no está conectada: no están respondiendo. Los números de abajo son de cuando sí lo hacían.",
  };
}
