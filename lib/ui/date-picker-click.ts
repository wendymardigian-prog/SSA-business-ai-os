/**
 * Clic en cualquier parte de un campo de fecha abre su calendario. PURO (salvo `openPickerFor`, que solo llama al navegador).
 *
 * El campo nativo de fecha abre el calendario solo con el iconito de la derecha: en el resto del campo, un clic
 * pone el cursor en el día, el mes o el año. Un escuchador en todo el documento (`DatePickerOpener`, montado en
 * `app/layout.tsx`) llama a `showPicker()` del navegador en cada clic sobre uno de estos campos, así cubre los que
 * hay y los que se agreguen, sin tocarlos uno por uno.
 */

/** Los tipos de campo que tienen un selector del navegador. */
export const PICKER_INPUT_TYPES: ReadonlySet<string> = new Set(["date", "datetime-local", "month", "week", "time"]);

export interface PickerCandidate {
  tagName: string;
  type?: string;
  disabled?: boolean;
  readOnly?: boolean;
}

/** ¿Este elemento es un campo de fecha (u hora) habilitado y editable? */
export function shouldOpenPicker(el: PickerCandidate | null | undefined): boolean {
  if (!el || el.tagName?.toUpperCase() !== "INPUT") return false;
  if (!PICKER_INPUT_TYPES.has((el.type ?? "").toLowerCase())) return false;
  return !el.disabled && !el.readOnly;
}

/**
 * Abre el selector. Nunca lanza: un navegador sin `showPicker`, un campo dentro de un iframe de otro dominio (el
 * embed de formularios) o un selector que ya está abierto dejan el campo como siempre (se puede escribir la fecha).
 */
export function openPickerFor(el: PickerCandidate & { showPicker?: () => void }): boolean {
  if (!shouldOpenPicker(el) || typeof el.showPicker !== "function") return false;
  try {
    el.showPicker();
    return true;
  } catch {
    return false;
  }
}
