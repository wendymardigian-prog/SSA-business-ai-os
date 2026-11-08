// @plantilla-quitar(servicios)
/**
 * Lo que existe en cada corrida (requerimientos §6, "Lo que existe por corrida").
 *
 * Las listas que crecen con las corridas se arman desde aca. A1 deja lo suyo; la Corrida C (extension
 * de proyectos) suma `fame` y `projects` a las secciones. Un valor que la base acepta pero que esta
 * corrida no ofrece no se muestra y su validador lo rechaza con "Todavía no está disponible".
 */

/** Las secciones del portal que A1 ofrece, en el orden de la pantalla. */
export const AVAILABLE_SECTIONS = ["program", "calendar", "challenge", "certificate", "assistant", "community", "affiliates"] as const;
export type PortalSection = (typeof AVAILABLE_SECTIONS)[number];

/** Todas las secciones que acepta la base (CHECK de portal_access.section), incluidas las de la extension. */
export const ALL_SECTIONS = [...AVAILABLE_SECTIONS, "fame", "projects"] as const;

export const SECTION_LABELS: Record<(typeof ALL_SECTIONS)[number], string> = {
  program: "Programa",
  calendar: "Calendario",
  challenge: "Reto",
  certificate: "Certificado",
  assistant: "Asistente IA",
  community: "Comunidad",
  affiliates: "Afiliados",
  fame: "Sala de la fama",
  projects: "Mis proyectos",
};

/** Los tipos de paso del camino. */
export const ITEM_KINDS = [
  "form",
  "survey",
  "contract",
  "booking",
  "quiz",
  "activity",
  "program_item",
  "team_task",
  "student_task",
  "certificate",
  "open_section",
  "open_module",
  "checkbox",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  form: "Formulario",
  survey: "Encuesta",
  contract: "Contrato",
  booking: "Agenda",
  quiz: "Evaluación",
  activity: "Actividad",
  program_item: "Módulo o clase",
  team_task: "Tarea del equipo",
  student_task: "Tarea del cliente",
  certificate: "Certificado",
  open_section: "Se abre una sección",
  open_module: "Se abre un módulo o clase",
  checkbox: "Casilla",
};
