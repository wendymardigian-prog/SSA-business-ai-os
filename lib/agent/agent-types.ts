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
  | "copywriter"
  /** Aprobación de acciones, ejemplos y reglas aprendidas (00441, 00442). Formulario propio. */
  | "learning"
  /** Las herramientas que ofrece el asistente del equipo (00445). Formulario propio. */
  | "assistant_tools"
  /** Los analizadores por tipo de reunión del área del agente (00536). Lista propia. */
  | "analyzers";

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
    configSections: ["identity", "prompt", "model", "timing", "output", "guardrails", "closing", "learning"],
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

  // @plantilla-desde(servicios)
  /**
   * El tutor de un programa del portal (Servicios A1, F83). Uno por programa, atado para siempre
   * (`products.tutor_agent_id` y `config.program_id`, de solo lectura): lo crea `program_ensure_tutor` al prender el
   * Asistente IA del programa. Busca solo en los materiales de su programa y, de las clases, solo las que ese
   * estudiante tiene abiertas. Lo usa el portal (Parte 2); acá se configura.
   */
  student_tutor: {
    type: "student_tutor",
    label: "Tutor de programa",
    description: "Responde las dudas de los estudiantes de un programa con sus clases y materiales.",
    configSections: ["identity", "prompt", "model", "knowledge"],
    tabs: [
      { key: "config", label: "Configuracion", available: true, permission: "agents.edit" },
      { key: "knowledge", label: "Conocimiento", available: true, permission: "agents.edit" },
      { key: "runs", label: "Runs", available: true },
      { key: "costs", label: "Costos", available: true, permission: "ai_costs.view" },
    ],
    conversational: false,
  },
  // @plantilla-hasta(servicios)
  // @plantilla-desde(proyectos)
  /**
   * El revisor de proyectos de un programa (Corrida C, F119). Uno por programa, creado al prender Mis proyectos
   * (`app_servicio_proyectos.projects_ensure_reviewer`), su id en `products.portal_settings.projects.reviewer_agent_id`.
   * Analiza los pasos que la mesa de trabajo marca «con análisis»; gasta del mismo límite mensual del estudiante que
   * el tutor. Corre desde el portal (`portal_project_review`); acá se configura.
   */
  project_reviewer: {
    type: "project_reviewer",
    label: "Revisor de proyectos",
    description: "Analiza los documentos de los proyectos de los estudiantes de un programa con las instrucciones de la mesa de trabajo.",
    configSections: ["identity", "prompt", "model"],
    tabs: [
      { key: "config", label: "Configuracion", available: true, permission: "agents.edit" },
      { key: "runs", label: "Runs", available: true },
      { key: "costs", label: "Costos", available: true, permission: "ai_costs.view" },
    ],
    conversational: false,
  },
  // @plantilla-hasta(proyectos)
  // @plantilla-desde(disenador)
  /**
   * El asistente del equipo (00444, traído de RER). Uno por negocio, nace apagado. Lo usa quien tiene «Usar el
   * asistente», con su sesión: solo ve lo que su rol ve y lo que escribe queda propuesto para que lo apruebe.
   */
  assistant: {
    type: "assistant",
    label: "Asistente del equipo",
    description: "Responde preguntas del equipo con sus contactos, conversaciones, tareas, agenda, servicios y Conocimiento; lo que escribe espera aprobación.",
    configSections: ["identity", "prompt", "model", "assistant_tools"],
    tabs: [
      { key: "config", label: "Configuracion", available: true, permission: "agents.edit" },
      { key: "runs", label: "Runs", available: true },
      { key: "costs", label: "Costos", available: true, permission: "ai_costs.view" },
    ],
    conversational: false,
  },
  // @plantilla-hasta(disenador)
  // @plantilla-desde(llamadas)
  /**
   * El analizador de las reuniones de Ventas (00536, traído de RER). Declarado en el código, uno por negocio y apagado
   * al nacer. Aporta el modelo a los análisis de las grabaciones del área Ventas y muestra los analizadores por tipo de
   * esa área: las instrucciones, la rúbrica y el modo de cada tipo se editan ahí mismo (`lib/calls/area-analyzers.ts`).
   */
  sales_analyzer: {
    type: "sales_analyzer",
    label: "Analizador de reuniones de Ventas",
    description: "Analiza solo las grabaciones clasificadas como Ventas con la rúbrica de ventas.",
    configSections: ["identity", "model", "analyzers"],
    tabs: [
      { key: "config", label: "Configuracion", available: true, permission: "agents.edit" },
      { key: "runs", label: "Runs", available: true },
      { key: "costs", label: "Costos", available: true, permission: "ai_costs.view" },
    ],
    conversational: false,
  },
  /** El analizador de las reuniones de Servicio (00536): lo mismo, para el área Servicio. */
  service_analyzer: {
    type: "service_analyzer",
    label: "Analizador de reuniones de Servicio",
    description: "Analiza solo las grabaciones clasificadas como Servicio y propone lo que hay que hacer; nada se ejecuta sin aprobación.",
    configSections: ["identity", "model", "analyzers"],
    tabs: [
      { key: "config", label: "Configuracion", available: true, permission: "agents.edit" },
      { key: "runs", label: "Runs", available: true },
      { key: "costs", label: "Costos", available: true, permission: "ai_costs.view" },
    ],
    conversational: false,
  },
  // @plantilla-hasta(llamadas)
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
