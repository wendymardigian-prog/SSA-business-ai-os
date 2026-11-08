/**
 * Los atajos de teclado del editor (F18, F19, F20, F26): qué hace cada tecla según lo que esté pasando.
 *
 * - Flechas: mover 0,5 %; con Shift, 2 %.
 * - Supr / Retroceso: eliminar. ⌘D: duplicar. Esc: soltar (o salir de escribir). Enter: escribir en el texto elegido.
 * - `]` y `[`: adelante y atrás; con ⌘/Ctrl, al frente y al fondo.
 * - ⌘Z deshace; ⌘⇧Z (o ⌘Y) rehace. ⌘A selecciona todo.
 *
 * Mientras se escribe en un texto o en un campo, ninguno de estos atajos se dispara (salvo Esc): las teclas son del
 * texto. Módulo puro: recibe lo que hace falta del evento.
 */

import type { NudgeDirection } from "../canvas-math";

export type EditorCommand =
  | { type: "nudge"; direction: NudgeDirection; big: boolean }
  | { type: "delete" }
  | { type: "duplicate" }
  | { type: "escape" }
  | { type: "edit-text" }
  | { type: "forward" }
  | { type: "backward" }
  | { type: "front" }
  | { type: "back" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "select-all" };

export interface KeyInput {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export interface KeyContext {
  /** Se está escribiendo en un texto del lienzo o en un campo (nombre, buscador…). */
  typing: boolean;
  hasSelection: boolean;
}

const ARROWS: Record<string, NudgeDirection> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

/** El comando de una tecla, o null si no hace nada ahora. */
export function commandForKey(input: KeyInput, ctx: KeyContext): EditorCommand | null {
  const mod = input.metaKey || input.ctrlKey;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;

  if (key === "Escape") return { type: "escape" };
  // Escribiendo, las teclas son del texto: ni siquiera ⌘Z (deshace el navegador, dentro del texto).
  if (ctx.typing) return null;

  if (mod && key === "z") return input.shiftKey ? { type: "redo" } : { type: "undo" };
  if (mod && key === "y") return { type: "redo" };
  if (mod && key === "a") return { type: "select-all" };
  if (!ctx.hasSelection) return null;

  if (key in ARROWS && !mod && !input.altKey) return { type: "nudge", direction: ARROWS[key], big: input.shiftKey };
  if (key === "Delete" || key === "Backspace") return { type: "delete" };
  if (mod && key === "d") return { type: "duplicate" };
  if (key === "Enter" && !mod) return { type: "edit-text" };
  if (key === "]" || key === "}") return mod ? { type: "front" } : { type: "forward" };
  if (key === "[" || key === "{") return mod ? { type: "back" } : { type: "backward" };
  return null;
}

export interface ShortcutHelp {
  keys: string;
  does: string;
}

/** Los atajos que se ven en la pestaña Capas y en el «?» de la barra del lienzo. */
export const SHORTCUTS: readonly ShortcutHelp[] = [
  { keys: "← ↑ → ↓", does: "mover 0,5 %" },
  { keys: "Shift + flecha", does: "mover 2 %" },
  { keys: "Supr", does: "eliminar" },
  { keys: "⌘ D", does: "duplicar" },
  { keys: "] · [", does: "adelante · atrás" },
  { keys: "⌘ ] · ⌘ [", does: "al frente · al fondo" },
  { keys: "Doble clic · Enter", does: "escribir" },
  { keys: "Esc", does: "soltar" },
  { keys: "⌘ Z · ⌘ ⇧ Z", does: "deshacer · rehacer" },
  { keys: "Alt al arrastrar", does: "sin imanes" },
  { keys: "Shift al rotar", does: "pasos de 15°" },
];
