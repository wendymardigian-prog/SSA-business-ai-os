/**
 * Registro de TIPOS de agente.
 *
 * La pantalla de Agentes no pregunta "si es de chat mostra esto": lee que
 * secciones de configuracion declara el tipo y las muestra. El agente de
 * contenido (Etapa 2/3) y el de gestion (Etapa 3) se suman como una entrada
 * nueva aca, con sus secciones, sin tocar la pantalla.
 *
 * Sin dependencias de servidor: lo importa la UI.
 */

export type AgentConfigSection =
  | "identity"
  | "prompt"
  | "model"
  | "timing"
  | "output"
  | "guardrails"
  | "closing"
  | "knowledge"
  | "channels"
  /** La voz, los limites y los topes del copywriter (E3). */
  | "copywriter";

export interface AgentTypeDefinition {
  type: string;
  label: string;
  description: string;
  /** Secciones de la pestana Configuracion, en orden. */
  configSections: AgentConfigSection[];
  /**
   * Pestanas del detalle. permission: la clave que pide la pestaña (sin clave la ve quien ve el agente); un Member ve Runs y
   * Acciones (acotadas a su scope por RLS) y nada de configuracion ni costos.
   */
  tabs: Array<{ key: string; label: string; available: boolean; permission?: string }>;
  /** Si responde a leads en conversaciones de la bandeja. */
  conversational: boolean;
}

export const AGENT_TYPES: Record<string, AgentTypeDefinition> = {
  chat: {
    type: "chat",
    label: "Agente de conversacion",
    description: "Responde a los leads en los canales conectados, con su prompt, sus limites y la base de conocimiento.",
    configSections: ["identity", "prompt", "model", "timing", "output", "guardrails", "closing"],
    tabs: [
      { key: "config", label: "Configuracion", available: true, permission: "agents.edit" },
      { key: "tools", label: "Herramientas", available: true, permission: "agents.edit" },
      { key: "knowledge", label: "Conocimiento", available: true, permission: "agents.edit" },
      { key: "channels", label: "Canales", available: true, permission: "agents.edit" },
      { key: "runs", label: "Runs", available: true },
      { key: "actions", label: "Acciones", available: true },
      { key: "costs", label: "Costos", available: true, permission: "ai_costs.view" },
      // Bloque 2d-A: el efecto de cada etiqueta sobre el agente.
      { key: "tags", label: "Etiquetas", available: true, permission: "agents.edit" },
    ],
    conversational: true,
  },

  /**
   * El copywriter (grupo E).
   *
   * Escribe el guion y los captions de cada pieza. NO conversa, no publica y
   * no cambia estados: lo unico que toca es el borrador, y siempre deja una
   * version con su firma para que se pueda volver atras.
   *
   * Reemplaza la generacion simple de F29, que no tenia configuracion propia
   * ni dejaba rastro de cuanto costaba.
   */
  copywriter: {
    type: "copywriter",
    label: "Copywriter de contenido",
    description: "Escribe el guion y los captions de cada pieza con la voz de tu marca.",
    configSections: ["identity", "prompt", "model", "copywriter"],
    tabs: [
      { key: "config", label: "Configuracion", available: true, permission: "agents.edit" },
      { key: "knowledge", label: "Conocimiento", available: true, permission: "agents.edit" },
      { key: "runs", label: "Runs", available: true },
      { key: "costs", label: "Costos", available: true, permission: "ai_costs.view" },
    ],
    conversational: false,
  },
};

export function getAgentType(type: string): AgentTypeDefinition | null {
  return AGENT_TYPES[type] ?? null;
}

/** Las pestanas que puede ver un rol, y cual abre por defecto. */
export function tabsForViewer(typeDef: AgentTypeDefinition, can: (permission: string) => boolean) {
  const tabs = typeDef.tabs.filter((t) => !t.permission || can(t.permission));
  const first = tabs.find((t) => t.available)?.key ?? "runs";
  return { tabs, defaultTab: first };
}
