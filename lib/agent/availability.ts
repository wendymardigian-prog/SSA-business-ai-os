/**
 * Si un agente puede funcionar HOY: la regla unica de disponibilidad (E1).
 *
 * Antes cada pantalla decidia por su cuenta: la lista de agentes decia
 * "Encendido" aunque no hubiera ninguna IA conectada, el interruptor de la
 * bandeja dejaba prender un agente sin modelo, y al desconectar un proveedor
 * los agentes que lo usaban seguian "encendidos" y fallaban en cada mensaje
 * (escalando la conversacion a una persona cada vez).
 *
 * Esta funcion es la unica que combina las tres cosas: el interruptor del
 * agente, el modelo que eligio y las IAs conectadas. La usan la lista y el
 * detalle de Agentes IA, el interruptor, el despacho de turnos, el boton
 * "Sugerir respuesta", la cabecera de la bandeja y el dashboard del chat.
 *
 * Regla de oro: lo que cambia es el ESTADO EFECTIVO, nunca la configuracion.
 * Desconectar una IA no apaga ni borra ningun agente: `isEnabled` queda como
 * estaba, asi reconectar la IA lo deja funcionando como antes.
 *
 * Puro.
 */

export type AvailabilityState = "active" | "off" | "blocked";
export type AvailabilityBlock = "no_provider" | "provider_disconnected" | "no_model";

export interface AgentAvailability {
  /** `active` responde; `off` esta apagado a proposito; `blocked` esta encendido pero no puede responder. */
  state: AvailabilityState;
  /** Por que no puede funcionar (con el agente prendido o apagado). null = nada lo bloquea. */
  blockedBy: AvailabilityBlock | null;
  /** Se lo puede encender ahora. */
  canEnable: boolean;
  /** Explicacion lista para mostrar, o null si no hace falta. */
  message: string | null;
}

export interface AgentAvailabilityInput {
  isEnabled: boolean;
  /** El proveedor que eligio el agente (null = usa el modelo del negocio). */
  provider: string | null;
  model?: string | null;
  /** Un agente que conversa necesita su propio modelo; el copywriter usa el del negocio. */
  conversational: boolean;
  /** Los proveedores de IA de texto conectados hoy (ids: anthropic, openai, google_ai). */
  connectedProviders: readonly string[];
}

const LABELS: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google_ai: "Google" };
export const providerName = (provider: string | null | undefined): string => (provider ? (LABELS[provider] ?? provider) : "la IA");

export function agentAvailability(input: AgentAvailabilityInput): AgentAvailability {
  let blockedBy: AvailabilityBlock | null = null;
  let message: string | null = null;

  if (input.connectedProviders.length === 0) {
    blockedBy = "no_provider";
    message = "No hay ninguna IA conectada. Conectá una en Integraciones para poder usar agentes.";
  } else if (input.conversational && input.provider && !input.connectedProviders.includes(input.provider)) {
    blockedBy = "provider_disconnected";
    message = `Falta la conexión con ${providerName(input.provider)}, que es la IA de este agente. Reconectala en Integraciones o elegí otra.`;
  } else if (input.conversational && (!input.provider || !input.model)) {
    blockedBy = "no_model";
    message = "Antes de encenderlo, elegí el proveedor y el modelo.";
  }

  const state: AvailabilityState = !input.isEnabled ? "off" : blockedBy ? "blocked" : "active";
  return { state, blockedBy, canEnable: blockedBy === null, message };
}

/** El texto corto que acompana al estado en una tarjeta ("Encendido, pero no responde: ..."). */
export function availabilityBadge(availability: AgentAvailability): { label: string; tone: "ok" | "off" | "warn" } {
  if (availability.state === "active") return { label: "Encendido", tone: "ok" };
  if (availability.state === "blocked") return { label: "Encendido, pero no responde", tone: "warn" };
  return { label: "Apagado", tone: "off" };
}

export interface AgentForAvailability {
  name: string;
  isEnabled: boolean;
  provider: string | null;
  model?: string | null;
  conversational: boolean;
}

/**
 * Los agentes ENCENDIDOS que quedan sin poder responder con estas IAs
 * conectadas (despues de desconectar una). Es lo que se avisa en la campana:
 * `isEnabled` no cambia, pero quien administra tiene que enterarse.
 */
export function agentsLeftWithoutAi(agents: readonly AgentForAvailability[], connectedProviders: readonly string[]): string[] {
  return agents
    .filter((agent) => agent.isEnabled && agentAvailability({ ...agent, connectedProviders }).state === "blocked")
    .map((agent) => agent.name);
}
