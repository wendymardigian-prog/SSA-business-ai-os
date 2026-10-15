/**
 * Las secciones de General (S2; Ventas se sumó con la Etapa 5), como datos puros: la navegación
 * interna de la pestaña sale de acá, igual que
 * lib/scheduling/config-sections.ts para la Configuración de Agenda.
 *
 * No hay "Zona de peligro": hoy no existe nada destructivo en Ajustes (no
 * hay transferir la propiedad ni borrar el workspace). El día que exista,
 * se suma una entrada acá.
 */

export interface GeneralSection {
  id: "workspace" | "conversaciones" | "archivos" | "ventas" | "finanzas" | "ia" | "atribucion";
  label: string;
  /** La clave que hace falta para ver esta seccion (Equipo y roles, F16). */
  permission: "settings.general" | "sales.settings" | "expenses.manage";
}

/**
 * General se parte por permiso: «General» (nombre, palabras clave, no contactar, zona horaria,
 * retención de archivos y, desde el Extra I, «Atribución») pide `settings.general`; «Ventas y cobranza» (métodos de pago, tope de
 * descuento, días de gracia, flujos de cobranza) pide `sales.settings`; «Finanzas» (categorías de gasto y,
 * más adelante, los gastos automáticos) pide `expenses.manage`.
 */
export const GENERAL_SECTIONS: GeneralSection[] = [
  { id: "workspace", label: "Workspace", permission: "settings.general" },
  { id: "conversaciones", label: "Conversaciones", permission: "settings.general" },
  { id: "archivos", label: "Archivos", permission: "settings.general" },
  { id: "ventas", label: "Ventas y cobranza", permission: "sales.settings" },
  { id: "finanzas", label: "Finanzas", permission: "expenses.manage" },
  { id: "ia", label: "IA", permission: "settings.general" },
  { id: "atribucion", label: "Atribución", permission: "settings.general" },
];

/** Las secciones que ve quien tiene estas claves (Owner y Admin las tienen todas). */
export function generalSectionsFor(can: (key: string) => boolean): GeneralSection[] {
  return GENERAL_SECTIONS.filter((section) => can(section.permission));
}

/** Si la persona tiene algo que ver en General. */
export function canOpenGeneral(can: (key: string) => boolean): boolean {
  return generalSectionsFor(can).length > 0;
}

/**
 * Destino del link a Corridas (S7). `ai_costs.view` ya existe en el
 * catálogo de permisos; no hace falta ninguna clave nueva.
 */
export const AI_RUNS_HREF = "/dashboard/agents/runs";
