/**
 * El estado de la selección del lienzo (F18): seleccionar, sumar con Shift, arrastrar un rectángulo, bloquear y entrar a
 * escribir.
 *
 * - Un clic selecciona un elemento; un clic en vacío deselecciona. Shift+clic suma o saca.
 * - Un rectángulo en vacío selecciona todo lo que toca (`intersects`). Un elemento OCULTO no se selecciona así.
 * - Doble clic (o Enter) sobre un texto entra a escribir; Esc sale. Solo con UN texto seleccionado.
 * - Un elemento BLOQUEADO se selecciona pero no se mueve ni se edita.
 * - En un HTML cargado se puede elegir UN texto de adentro (`text`, su marca `data-tx`); doble clic lo deja escribir.
 *
 * Módulo puro (inmutable).
 */

import { intersects, type Box } from "../canvas-math";
import type { DesignElement } from "../doc/schema";

export interface SelectionState {
  /** Los elementos seleccionados, en el orden en que se eligieron. */
  ids: string[];
  /** El texto que se está escribiendo (siempre uno de `ids`). En un HTML cargado, el bloque cuyo `text` se escribe. */
  editing: string | null;
  /** Un texto de adentro de un HTML cargado (su bloque es la única selección). Sin esto, el bloque entero. */
  text?: HtmlTextTarget | null;
}

export interface HtmlTextTarget {
  /** El id del bloque HTML. */
  el: string;
  /** La marca `data-tx` del texto. */
  tx: string;
}

export const EMPTY_SELECTION: SelectionState = { ids: [], editing: null };

export function isSelected(state: SelectionState, id: string): boolean {
  return state.ids.includes(id);
}

/** Selecciona SOLO este elemento. */
export function selectOnly(state: SelectionState, id: string): SelectionState {
  if (state.ids.length === 1 && state.ids[0] === id) return state;
  return { ids: [id], editing: null };
}

/** Shift+clic: suma el elemento a la selección, o lo saca si ya estaba. */
export function toggle(state: SelectionState, id: string): SelectionState {
  const ids = state.ids.includes(id) ? state.ids.filter((x) => x !== id) : [...state.ids, id];
  return { ids, editing: null };
}

/** Un clic sobre un elemento: con Shift suma o saca; sin Shift selecciona solo ese (salvo que ya esté en un grupo). */
export function clickElement(state: SelectionState, id: string, additive: boolean): SelectionState {
  return additive ? toggle(state, id) : selectOnly(state, id);
}

export function clear(state: SelectionState): SelectionState {
  return state.ids.length === 0 && state.editing === null ? state : EMPTY_SELECTION;
}

export interface SelectableBox {
  id: string;
  box: Box;
  hidden?: boolean;
}

/**
 * Arrastrar un rectángulo en vacío: selecciona todos los elementos visibles que toca. Con `additive` (Shift) se suma a
 * lo que ya estaba seleccionado.
 */
export function selectRect(state: SelectionState, items: readonly SelectableBox[], rect: Box, additive = false): SelectionState {
  const hit = items.filter((item) => !item.hidden && intersects(item.box, rect)).map((item) => item.id);
  const ids = additive ? [...state.ids, ...hit.filter((id) => !state.ids.includes(id))] : hit;
  return { ids, editing: null };
}

/** Selecciona todo lo visible de la página. */
export function selectAll(items: readonly SelectableBox[]): SelectionState {
  return { ids: items.filter((item) => !item.hidden).map((item) => item.id), editing: null };
}

/** Un elemento bloqueado no se mueve, no cambia de tamaño ni se edita (sí se selecciona). */
export function canMove(el: Pick<DesignElement, "locked">): boolean {
  return !el.locked;
}

export function canEditText(el: Pick<DesignElement, "locked" | "type" | "hidden">): boolean {
  return el.type === "text" && !el.locked && !el.hidden;
}

/** Elegir un texto de adentro de un HTML cargado: el bloque queda como única selección, con ese texto marcado. */
export function selectHtmlText(state: SelectionState, elId: string, tx: string): SelectionState {
  if (state.ids.length === 1 && state.ids[0] === elId && state.editing === null && state.text?.el === elId && state.text.tx === tx) return state;
  return { ids: [elId], editing: null, text: { el: elId, tx } };
}

/** Los elementos seleccionados que se pueden mover (sin los bloqueados). */
export function movableIds(state: SelectionState, elements: readonly DesignElement[]): string[] {
  return elements.filter((el) => state.ids.includes(el.id) && canMove(el)).map((el) => el.id);
}

/** Doble clic o Enter sobre un texto: entra a escribir. Solo con ese texto como única selección y sin bloqueo. */
export function startEditing(state: SelectionState, el: Pick<DesignElement, "id" | "locked" | "type" | "hidden">): SelectionState {
  if (el.type === "html") {
    // En un HTML cargado se escribe el texto elegido adentro, no el bloque.
    const text = state.text;
    if (!text || text.el !== el.id || el.locked || el.hidden) return state;
    return { ids: [el.id], editing: el.id, text };
  }
  if (!canEditText(el)) return state;
  return { ids: [el.id], editing: el.id };
}

/** Esc: sale de escribir y deja el texto seleccionado. */
export function stopEditing(state: SelectionState): SelectionState {
  return state.editing === null ? state : { ...state, editing: null };
}

/** Después de borrar o cambiar de página: saca lo que ya no está en la página. */
export function reconcile(state: SelectionState, elements: readonly Pick<DesignElement, "id">[]): SelectionState {
  const present = new Set(elements.map((el) => el.id));
  const ids = state.ids.filter((id) => present.has(id));
  if (ids.length === state.ids.length && (state.editing === null || present.has(state.editing))) return state;
  return { ids, editing: state.editing !== null && present.has(state.editing) ? state.editing : null };
}

/** El único elemento seleccionado (la barra del elemento solo aparece con uno). */
export function soleSelected(state: SelectionState): string | null {
  return state.ids.length === 1 ? state.ids[0] : null;
}

/** Los ids de un grupo cuando se arrastra un elemento: si ya estaba seleccionado, todo el grupo; si no, solo ese. */
export function dragGroup(state: SelectionState, grabbedId: string): string[] {
  return state.ids.includes(grabbedId) ? state.ids : [grabbedId];
}
