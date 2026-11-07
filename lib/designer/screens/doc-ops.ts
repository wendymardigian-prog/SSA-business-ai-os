/**
 * Operaciones sobre el `DesignDoc` que usa el editor (F18–F25): cambiar, agregar, borrar y duplicar elementos de una
 * página y alinearlos. Todo inmutable: devuelve un documento nuevo (o el mismo si no había nada que cambiar), así el
 * historial (`history.ts`) puede compararlos por identidad.
 *
 * Los elementos de texto no tienen alto propio (`h`): se mide en el lienzo. Para alinear y para los imanes, `boxOf`
 * recibe ese alto medido (en % de la página) y, si no lo hay, lo estima.
 *
 * Módulo puro.
 */

import { alignSelection, type AlignMode, type Box } from "../canvas-math";
import { clamp } from "../color";
import { newId, type DesignDoc, type DesignElement, type DesignPage } from "../doc/schema";
import { FORMATS } from "../formats";

export type ElementPatch = Partial<DesignElement> & Record<string, unknown>;

/** Cambia la página `pageIndex` con `update`. Una página que no existe deja el documento igual. */
export function mapPage(doc: DesignDoc, pageIndex: number, update: (page: DesignPage) => DesignPage): DesignDoc {
  const page = doc.pages[pageIndex];
  if (!page) return doc;
  const next = update(page);
  if (next === page) return doc;
  return { ...doc, pages: doc.pages.map((p, i) => (i === pageIndex ? next : p)) };
}

/** Cambia varios elementos de una página, cada uno con su parche. Lo que no cambia queda con la misma identidad. */
export function patchElements(doc: DesignDoc, pageIndex: number, patches: Readonly<Record<string, ElementPatch>>): DesignDoc {
  return mapPage(doc, pageIndex, (page) => {
    let changed = false;
    const elements = page.elements.map((el) => {
      const patch = patches[el.id];
      if (!patch) return el;
      const entries = Object.entries(patch);
      if (entries.every(([key, value]) => (el as Record<string, unknown>)[key] === value)) return el;
      changed = true;
      return { ...el, ...patch } as DesignElement;
    });
    return changed ? { ...page, elements } : page;
  });
}

export function patchElement(doc: DesignDoc, pageIndex: number, id: string, patch: ElementPatch): DesignDoc {
  return patchElements(doc, pageIndex, { [id]: patch });
}

/** Reemplaza un elemento entero (por ejemplo, tras cambiar una propiedad anidada). */
export function replaceElement(doc: DesignDoc, pageIndex: number, element: DesignElement): DesignDoc {
  return mapPage(doc, pageIndex, (page) => {
    const index = page.elements.findIndex((el) => el.id === element.id);
    if (index < 0 || page.elements[index] === element) return page;
    return { ...page, elements: page.elements.map((el, i) => (i === index ? element : el)) };
  });
}

/** Agrega un elemento ADELANTE de todos (el último del arreglo queda arriba). */
export function addElement(doc: DesignDoc, pageIndex: number, element: DesignElement): DesignDoc {
  return mapPage(doc, pageIndex, (page) => ({ ...page, elements: [...page.elements, element] }));
}

export function removeElements(doc: DesignDoc, pageIndex: number, ids: readonly string[]): DesignDoc {
  if (ids.length === 0) return doc;
  const drop = new Set(ids);
  return mapPage(doc, pageIndex, (page) => (page.elements.some((el) => drop.has(el.id)) ? { ...page, elements: page.elements.filter((el) => !drop.has(el.id)) } : page));
}

/** Cuánto se corre un duplicado (en % de la página) para que no quede justo encima del original. */
export const DUPLICATE_OFFSET = 3;

/**
 * Duplica elementos: cada copia con id nuevo, corrida un poco, justo adelante de su original. Devuelve el documento y
 * los ids de las copias (para dejarlas seleccionadas).
 */
export function duplicateElements(doc: DesignDoc, pageIndex: number, ids: readonly string[], random?: () => number): { doc: DesignDoc; ids: string[] } {
  const page = doc.pages[pageIndex];
  if (!page) return { doc, ids: [] };
  const wanted = new Set(ids);
  const created: string[] = [];
  const elements: DesignElement[] = [];
  for (const el of page.elements) {
    elements.push(el);
    if (!wanted.has(el.id)) continue;
    // La copia nace desbloqueada: se duplica para moverla.
    const copy: DesignElement = { ...el, id: newId("el", random), x: clamp(el.x + DUPLICATE_OFFSET, 0, 100), y: clamp(el.y + DUPLICATE_OFFSET, 0, 100) };
    delete copy.locked;
    elements.push(copy);
    created.push(copy.id);
  }
  if (created.length === 0) return { doc, ids: [] };
  return { doc: mapPage(doc, pageIndex, (p) => ({ ...p, elements })), ids: created };
}

/** Los ids de todos los elementos del documento (para comprobar que no se repiten). */
export function allElementIds(doc: DesignDoc): string[] {
  return doc.pages.flatMap((page) => page.elements.map((el) => el.id));
}

// ─── Cajas (para imanes, selección con rectángulo y alinear) ─────────────────

/** El alto de un texto en % de la página, estimado cuando no se pudo medir (cantidad de renglones × letra × interlineado). */
export function estimateTextHeightPct(el: Extract<DesignElement, { type: "text" }>, doc: Pick<DesignDoc, "format" | "pages">, pageIndex: number): number {
  const format = FORMATS[doc.format];
  const pageHeight = doc.format === "web" ? (doc.pages[pageIndex]?.height ?? format.height) : format.height;
  const widthPx = (el.w / 100) * format.width;
  // Los chips de variable se estiman con 14 caracteres; el ancho de un carácter, con 0,55 del tamaño de letra.
  const plain = el.text.replace(/\{\{[^{}]*\}\}/g, "x".repeat(14));
  const perLine = Math.max(1, Math.floor(widthPx / (el.size * 0.55)));
  const lines = plain.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
  return clamp(((lines * el.size * (el.lineHeight ?? 1.2)) / pageHeight) * 100, 0.5, 100);
}

/** La caja de un elemento: su alto propio, el medido en el lienzo o una estimación (solo textos). */
export function boxOf(el: DesignElement, doc: Pick<DesignDoc, "format" | "pages">, pageIndex: number, measuredHeightPct?: number): Box {
  if (el.type !== "text") return { x: el.x, y: el.y, w: el.w, h: el.h ?? (el.type === "shape" && el.shape === "line" ? 0.5 : el.w) };
  return { x: el.x, y: el.y, w: el.w, h: el.h ?? measuredHeightPct ?? estimateTextHeightPct(el, doc, pageIndex) };
}

/** La caja que envuelve a varias cajas (para mover un grupo como una sola pieza). */
export function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const b of boxes) {
    left = Math.min(left, b.x - b.w / 2);
    right = Math.max(right, b.x + b.w / 2);
    top = Math.min(top, b.y - b.h / 2);
    bottom = Math.max(bottom, b.y + b.h / 2);
  }
  return { x: (left + right) / 2, y: (top + bottom) / 2, w: right - left, h: bottom - top };
}

/** Alinea los elementos elegidos a la página (izquierda, centro, derecha, arriba, medio, abajo). `heights` = alto medido de los textos. */
export function alignElements(doc: DesignDoc, pageIndex: number, ids: readonly string[], mode: AlignMode, heights: Readonly<Record<string, number>> = {}): DesignDoc {
  const page = doc.pages[pageIndex];
  if (!page) return doc;
  const chosen = page.elements.filter((el) => ids.includes(el.id) && !el.locked);
  if (chosen.length === 0) return doc;
  const aligned = alignSelection(
    chosen.map((el) => boxOf(el, doc, pageIndex, heights[el.id])),
    mode,
  );
  const patches: Record<string, ElementPatch> = {};
  chosen.forEach((el, i) => {
    patches[el.id] = { x: aligned[i].x, y: aligned[i].y };
  });
  return patchElements(doc, pageIndex, patches);
}
