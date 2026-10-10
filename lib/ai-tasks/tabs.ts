/**
 * Las pestañas de una tarea de IA: las MISMAS cinco para las siete tareas.
 * Si una no aplica (Instrucciones en una tarea que no usa un modelo de
 * lenguaje, por ejemplo), la pestaña igual está y dice por qué, en vez de
 * desaparecer: así todas las tareas se leen igual.
 *
 * Puro: lo usan la página (para cargar solo lo de la pestaña abierta) y la
 * vista.
 */
export const TASK_TABS = [
  { key: "como", label: "Cómo funciona" },
  { key: "config", label: "Configuración" },
  { key: "instrucciones", label: "Instrucciones" },
  { key: "runs", label: "Corridas" },
  { key: "costos", label: "Costos" },
] as const;

export type TaskTab = (typeof TASK_TABS)[number]["key"];

export const DEFAULT_TASK_TAB: TaskTab = "como";

/** La pestaña pedida por la URL, o la primera si no existe. */
export function resolveTaskTab(raw: unknown): TaskTab {
  return TASK_TABS.some((t) => t.key === raw) ? (raw as TaskTab) : DEFAULT_TASK_TAB;
}
