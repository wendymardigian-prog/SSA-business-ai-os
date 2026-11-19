/**
 * Qué hace un clic sobre una fila de tabla (o una tarjeta) que abre algo. Puro: lo usa `useRowOpen`
 * (components/ui/clickable-row.tsx) y lo prueba `row-click.test.ts`.
 *
 * La regla del sistema (18/11/2026): toda la fila abre el registro, no solo la primera columna. Lo que ya es un control
 * adentro de la fila (un link a otra cosa, un botón, una casilla, un desplegable) hace lo suyo y NO abre la fila.
 */

/** Lo que, si recibió el clic, gana sobre la fila. `data-row-stop` marca a mano un contenedor que tampoco abre la fila. */
export const ROW_INTERACTIVE_SELECTOR =
  'a,button,input,select,textarea,label,summary,[role="menu"],[role="menuitem"],[role="listbox"],[role="option"],[role="switch"],[role="checkbox"],[data-row-stop]';

export type RowClickIntent = "open" | "new-tab" | "ignore";

export interface RowClickInput {
  /** 0 = izquierdo, 1 = del medio (rueda), 2 = derecho. */
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  /** El clic cayó sobre un control de la fila (o adentro de uno). */
  targetIsInteractive: boolean;
  /** La persona estaba seleccionando texto con el mouse: no se abre nada. */
  hasTextSelection: boolean;
  /** La fila tiene una dirección propia (se puede abrir en otra pestaña). */
  hasHref: boolean;
}

export function rowClickIntent(input: RowClickInput): RowClickIntent {
  if (input.targetIsInteractive || input.hasTextSelection) return "ignore";
  if (input.button === 2) return "ignore";
  const wantsNewTab = input.button === 1 || input.metaKey || input.ctrlKey || input.shiftKey;
  if (wantsNewTab) return input.hasHref ? "new-tab" : input.button === 1 ? "ignore" : "open";
  return input.button === 0 ? "open" : "ignore";
}
