/**
 * Las capas de una página (F20): el orden de los elementos, ocultar y bloquear.
 *
 * El orden del arreglo `elements` ES el orden de capas: el ÚLTIMO queda adelante. La pestaña Capas lista de más
 * adelante a más atrás (el de arriba de la lista es el que está al frente) y, abajo y fijo, el Fondo.
 *
 * Todo devuelve un arreglo nuevo con los mismos elementos en otro orden (o el mismo arreglo si nada cambió): un orden
 * siempre es válido (sin repetidos ni faltantes). Ocultar no cambia el orden; un elemento oculto no sale en `public` ni
 * en `export` (lo hace `renderPageHTML`).
 *
 * Módulo puro.
 */

import { clamp } from "../color";
import type { DesignElement } from "../doc/schema";
import { IMPORTED_PAGE_NAME, isImportedPage } from "../import/imported-page";

export interface LayerRow {
  id: string;
  type: DesignElement["type"];
  name: string;
  hidden: boolean;
  locked: boolean;
  /** La posición en el arreglo (0 = el más atrás). */
  index: number;
}

/** El nombre de una capa: el que le puso la persona o, si no, uno derivado del contenido. */
export function layerName(el: DesignElement, variableLabel: (key: string) => string = (key) => key): string {
  if (el.name?.trim()) return el.name.trim();
  switch (el.type) {
    case "text": {
      const text = el.text.replace(/\{\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\}\}/g, (_m, key: string) => `[${variableLabel(key)}]`).replace(/\s+/g, " ").trim();
      return text ? (text.length > 40 ? `${text.slice(0, 40)}…` : text) : "Texto";
    }
    case "image": {
      const file = el.asset.split("/").pop() ?? "";
      return file || "Imagen";
    }
    case "shape":
      return el.shape === "circle" ? "Círculo" : el.shape === "line" ? "Línea" : "Forma";
    case "html":
      // Lo que se cargó como archivo (un HTML que ocupa toda la página) es la capa «Página cargada (HTML)».
      return isImportedPage(el) ? IMPORTED_PAGE_NAME : "Bloque HTML";
  }
}

/** Las filas de la pestaña Capas: el de más adelante primero. */
export function layerRows(elements: readonly DesignElement[], variableLabel?: (key: string) => string): LayerRow[] {
  return elements
    .map((el, index) => ({ id: el.id, type: el.type, name: layerName(el, variableLabel), hidden: !!el.hidden, locked: !!el.locked, index }))
    .reverse();
}

function move(elements: readonly DesignElement[], from: number, to: number): DesignElement[] {
  const target = clamp(to, 0, elements.length - 1);
  if (from < 0 || from >= elements.length || from === target) return elements as DesignElement[];
  const next = [...elements];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/** Mueve un elemento de la posición `from` a la `to` del arreglo (0 = el más atrás). Sirve para arrastrar y soltar. */
export function reorder(elements: readonly DesignElement[], from: number, to: number): DesignElement[] {
  return move(elements, from, to);
}

/** Lo mismo con ids y una posición de la LISTA (0 = el de más adelante), como lo ve la persona al arrastrar. */
export function moveToRow(elements: readonly DesignElement[], id: string, row: number): DesignElement[] {
  const from = elements.findIndex((el) => el.id === id);
  if (from < 0) return elements as DesignElement[];
  return move(elements, from, elements.length - 1 - clamp(row, 0, elements.length - 1));
}

const indexOf = (elements: readonly DesignElement[], id: string) => elements.findIndex((el) => el.id === id);

/** Traer al frente (`⌘ ]`). */
export function bringToFront(elements: readonly DesignElement[], id: string): DesignElement[] {
  const i = indexOf(elements, id);
  return i < 0 ? (elements as DesignElement[]) : move(elements, i, elements.length - 1);
}

/** Traer adelante (`]`): un lugar. */
export function bringForward(elements: readonly DesignElement[], id: string): DesignElement[] {
  const i = indexOf(elements, id);
  return i < 0 ? (elements as DesignElement[]) : move(elements, i, i + 1);
}

/** Enviar atrás (`[`): un lugar. */
export function sendBackward(elements: readonly DesignElement[], id: string): DesignElement[] {
  const i = indexOf(elements, id);
  return i < 0 ? (elements as DesignElement[]) : move(elements, i, i - 1);
}

/** Enviar al fondo (`⌘ [`): detrás de todos los demás elementos (el Fondo de la página siempre queda atrás de todo). */
export function sendToBack(elements: readonly DesignElement[], id: string): DesignElement[] {
  const i = indexOf(elements, id);
  return i < 0 ? (elements as DesignElement[]) : move(elements, i, 0);
}

export type OrderAction = "front" | "forward" | "backward" | "back";

export function applyOrder(elements: readonly DesignElement[], id: string, action: OrderAction): DesignElement[] {
  switch (action) {
    case "front":
      return bringToFront(elements, id);
    case "forward":
      return bringForward(elements, id);
    case "backward":
      return sendBackward(elements, id);
    case "back":
      return sendToBack(elements, id);
  }
}

/** Qué órdenes tienen sentido para un elemento (el de más adelante no se puede traer al frente). */
export function orderAvailability(elements: readonly DesignElement[], id: string): Record<OrderAction, boolean> {
  const i = indexOf(elements, id);
  const last = elements.length - 1;
  return { front: i >= 0 && i < last, forward: i >= 0 && i < last, backward: i > 0, back: i > 0 };
}

/** Ocultar o mostrar (el ojo). No cambia el orden. */
export function toggleHidden(elements: readonly DesignElement[], id: string): DesignElement[] {
  return elements.map((el) => {
    if (el.id !== id) return el;
    const next: DesignElement = { ...el };
    if (el.hidden) delete next.hidden;
    else next.hidden = true;
    return next;
  });
}

/** Bloquear o desbloquear (el candado). */
export function toggleLocked(elements: readonly DesignElement[], id: string): DesignElement[] {
  return elements.map((el) => {
    if (el.id !== id) return el;
    const next: DesignElement = { ...el };
    if (el.locked) delete next.locked;
    else next.locked = true;
    return next;
  });
}

/** Renombrar con doble clic. Un nombre vacío vuelve al derivado. */
export function renameLayer(elements: readonly DesignElement[], id: string, name: string): DesignElement[] {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 120);
  return elements.map((el) => {
    if (el.id !== id) return el;
    const next = { ...el };
    if (clean) next.name = clean;
    else delete next.name;
    return next;
  });
}

/** Si dos arreglos tienen los mismos elementos (sin repetidos ni faltantes), venga el orden que venga. */
export function sameElements(a: readonly DesignElement[], b: readonly DesignElement[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((el) => el.id));
  return ids.size === a.length && b.every((el) => ids.has(el.id)) && new Set(b.map((el) => el.id)).size === b.length;
}
