/**
 * Como se muestra Tareas segun el ancho (Extra A, F21). PURO.
 * Desde 768 px, la tabla; por debajo, una lista de tarjetas (la tabla de 9 columnas no entra en un celular).
 */

export const LIST_BREAKPOINT = 768;

export type TasksLayout = "table" | "list";

export function selectLayout(width: number): TasksLayout {
  return width < LIST_BREAKPOINT ? "list" : "table";
}
