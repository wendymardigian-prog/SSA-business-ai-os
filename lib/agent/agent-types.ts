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
   * Pestanas del detalle. adminOnly: solo Owner/Admin; un Member ve Runs y
   * Acciones (acotadas a su scope por RLS) y nada de configuracion ni costos.
   */
  tabs: Array<{ key: string; label: string; available: boolean; adminOnly: boolean }>;
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
      { key: "config", label: "Configuracion", available: true, adminOnly: true },
      { key: "tools", label: "Herramientas", available: true, adminOnly: true },
      { key: "knowledge", label: "Conocimiento", available: true, adminOnly: true },
      { key: "channels", label: "Canales", available: true, adminOnly: true },
      { key: "runs", label: "Runs", available: true, adminOnly: false },
      { key: "actions", label: "Acciones", available: true, adminOnly: false },
      { key: "costs", label: "Costos", available: true, adminOnly: true },
      // Bloque 2d-A: el efecto de cada etiqueta sobre el agente.
      { key: "tags", label: "Etiquetas", available: true, adminOnly: true },
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
      { key: "config", label: "Configuracion", available: true, adminOnly: true },
      { key: "knowledge", label: "Conocimiento", available: true, adminOnly: true },
      { key: "runs", label: "Runs", available: true, adminOnly: false },
      { key: "costs", label: "Costos", available: true, adminOnly: true },
    ],
    conversational: false,
  },
};

export function getAgentType(type: string): AgentTypeDefinition | null {
  return AGENT_TYPES[type] ?? null;
}

/** Las pestanas que puede ver un rol, y cual abre por defecto. */
export function tabsForViewer(typeDef: AgentTypeDefinition, isAdmin: boolean) {
  const tabs = typeDef.tabs.filter((t) => isAdmin || !t.adminOnly);
  const first = tabs.find((t) => t.available)?.key ?? "runs";
  return { tabs, defaultTab: first };
}
