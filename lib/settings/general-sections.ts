/**
 * Las cuatro secciones de General (S2), como datos puros: la navegación
 * interna de la pestaña sale de acá, igual que
 * lib/scheduling/config-sections.ts para la Configuración de Agenda.
 *
 * No hay "Zona de peligro": hoy no existe nada destructivo en Ajustes (no
 * hay transferir la propiedad ni borrar el workspace). El día que exista,
 * se suma una entrada acá.
 */

export interface GeneralSection {
  id: "workspace" | "conversaciones" | "archivos" | "ia";
  label: string;
}

export const GENERAL_SECTIONS: GeneralSection[] = [
  { id: "workspace", label: "Workspace" },
  { id: "conversaciones", label: "Conversaciones" },
  { id: "archivos", label: "Archivos" },
  { id: "ia", label: "IA" },
];

/**
 * Destino del link a Corridas (S7). `ai_costs.view` ya existe en el
 * catálogo de permisos; no hace falta ninguna clave nueva.
 */
export const AI_RUNS_HREF = "/dashboard/agents/runs";
