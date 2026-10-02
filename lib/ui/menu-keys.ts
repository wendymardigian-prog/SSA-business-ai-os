/**
 * Que hace una tecla adentro de un menu de filtros (`components/ui/filter-menu.tsx`).
 *
 * Modulo puro, sin DOM: el componente le pasa la tecla, si el foco esta en un
 * campo de formulario, y en que posicion de la lista de items esta; esto
 * devuelve que hacer. Asi la regla se prueba sin navegador.
 *
 * La regla de siempre (botones y opciones): flechas, Home y End recorren los
 * items; Esc cierra y devuelve el foco al boton; Tab cierra sin devolverlo.
 *
 * Lo que se suma para los campos (Bloque I, el popover de la Bandeja lleva un
 * `<select>` y dos `<input type="date">`): con el foco en un campo, las flechas,
 * Home y End son DEL CAMPO (cambiar la opcion, mover el cursor, subir el dia),
 * y Tab / Shift+Tab pasan al item siguiente / anterior sin cerrar el menu. Un
 * menu que no tiene campos se comporta exactamente igual que antes.
 */

export type MenuKeyAction =
  | { kind: "close" }
  | { kind: "dismiss" }
  | { kind: "focus"; index: number }
  | { kind: "native" };

export interface MenuKeyInput {
  key: string;
  shiftKey: boolean;
  /** El foco esta en un `<select>`, `<input>` o `<textarea>`. */
  onField: boolean;
  /** Posicion del item con foco en la lista navegable; -1 si ninguno. */
  index: number;
  /** Cuantos items navegables hay. */
  count: number;
}

/** Los items que se recorren con el teclado, en orden de documento. */
export const MENU_ITEM_SELECTOR =
  '[role="menuitemradio"]:not([disabled]), button:not([disabled]), select:not([disabled]), input:not([disabled])';

const FIELD_TAGS = new Set(["SELECT", "INPUT", "TEXTAREA"]);

export function isFormField(tagName: string | null | undefined): boolean {
  return !!tagName && FIELD_TAGS.has(tagName.toUpperCase());
}

function wrap(index: number, count: number): number {
  return (index + count) % count;
}

export function menuKeyAction({ key, shiftKey, onField, index, count }: MenuKeyInput): MenuKeyAction {
  if (key === "Escape") return { kind: "close" };

  if (key === "Tab") {
    if (!onField || count === 0) return { kind: "dismiss" };
    return { kind: "focus", index: wrap(index + (shiftKey ? -1 : 1), count) };
  }

  if (onField || count === 0) return { kind: "native" };

  switch (key) {
    case "ArrowDown":
      return { kind: "focus", index: wrap(index + 1, count) };
    case "ArrowUp":
      return { kind: "focus", index: wrap(index - 1, count) };
    case "Home":
      return { kind: "focus", index: 0 };
    case "End":
      return { kind: "focus", index: count - 1 };
    default:
      return { kind: "native" };
  }
}
