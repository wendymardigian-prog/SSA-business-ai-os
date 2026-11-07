/**
 * Las páginas de un diseño (F25): la tira de miniaturas de abajo del lienzo.
 *
 * Seleccionar, arrastrar para reordenar, «+» (una página en blanco con el fondo de la anterior) y el menú de cada
 * página: duplicar, eliminar, mover. Máximo 20 páginas (el carrusel de Instagram admite 20; TikTok, 35: eso se avisa al
 * usar en contenido). Una página web tiene UNA sola: no hay tira.
 *
 * Todo inmutable. Eliminar la última página no se puede (el documento nunca queda sin páginas).
 *
 * Módulo puro.
 */

import { clamp } from "../color";
import { newId, type DesignDoc, type DesignPage } from "../doc/schema";
import { FORMATS, MAX_PAGES } from "../formats";

/** La tira de páginas existe si el formato admite varias (una página web no tiene). */
export function hasPageStrip(doc: Pick<DesignDoc, "format">): boolean {
  return FORMATS[doc.format].multiPage;
}

export function canAddPage(doc: Pick<DesignDoc, "format" | "pages">): boolean {
  return hasPageStrip(doc) && doc.pages.length < MAX_PAGES;
}

export function canDeletePage(doc: Pick<DesignDoc, "format" | "pages">): boolean {
  return hasPageStrip(doc) && doc.pages.length > 1;
}

/** Por qué «+» o duplicar no se pueden (null = se puede). */
export function addPageBlockedReason(doc: Pick<DesignDoc, "format" | "pages">): string | null {
  if (!hasPageStrip(doc)) return "Una página web tiene una sola página.";
  if (doc.pages.length >= MAX_PAGES) return `El máximo son ${MAX_PAGES} páginas.`;
  return null;
}

/** La página en la que cae un índice (nunca fuera del documento). */
export function clampPageIndex(doc: Pick<DesignDoc, "pages">, index: number): number {
  return clamp(Math.trunc(index), 0, doc.pages.length - 1);
}

function insertAt(doc: DesignDoc, index: number, page: DesignPage): DesignDoc {
  const pages = [...doc.pages];
  pages.splice(index, 0, page);
  return { ...doc, pages };
}

/** «+»: una página en blanco con el fondo (color, degradé o imagen y su capa) de la que está antes. */
export function addPage(doc: DesignDoc, afterIndex: number = doc.pages.length - 1, random?: () => number): { doc: DesignDoc; index: number } {
  if (!canAddPage(doc)) return { doc, index: clampPageIndex(doc, afterIndex) };
  const source = doc.pages[clampPageIndex(doc, afterIndex)];
  const page: DesignPage = { id: newId("pg", random), background: structuredClone(source.background), elements: [] };
  const index = clampPageIndex(doc, afterIndex) + 1;
  return { doc: insertAt(doc, index, page), index };
}

/** Duplicar: la copia justo después, con los elementos con ids NUEVOS (un id repetido en el documento no se acepta). */
export function duplicatePage(doc: DesignDoc, index: number, random?: () => number): { doc: DesignDoc; index: number } {
  if (!canAddPage(doc)) return { doc, index: clampPageIndex(doc, index) };
  const at = clampPageIndex(doc, index);
  const source = doc.pages[at];
  const page: DesignPage = {
    ...structuredClone(source),
    id: newId("pg", random),
    elements: source.elements.map((el) => ({ ...structuredClone(el), id: newId("el", random) })),
  };
  return { doc: insertAt(doc, at + 1, page), index: at + 1 };
}

/**
 * Eliminar. Eliminar la última página que queda no hace nada (el documento nunca queda sin páginas). Devuelve la página
 * que queda seleccionada: la misma posición, o la anterior si era la última.
 */
export function deletePage(doc: DesignDoc, index: number): { doc: DesignDoc; index: number } {
  if (!canDeletePage(doc)) return { doc, index: clampPageIndex(doc, index) };
  const at = clampPageIndex(doc, index);
  const pages = doc.pages.filter((_, i) => i !== at);
  return { doc: { ...doc, pages }, index: Math.min(at, pages.length - 1) };
}

/** Mover una página de un lugar a otro (arrastrar y soltar, o «Mover a la izquierda / derecha»). */
export function movePage(doc: DesignDoc, from: number, to: number): { doc: DesignDoc; index: number } {
  const source = clampPageIndex(doc, from);
  const target = clampPageIndex(doc, to);
  if (source === target) return { doc, index: target };
  const pages = [...doc.pages];
  const [page] = pages.splice(source, 1);
  pages.splice(target, 0, page);
  return { doc: { ...doc, pages }, index: target };
}

/** Con qué índice queda seleccionada la página que se estaba mirando después de mover otra (sigue a su página). */
export function followSelected(selected: number, from: number, to: number): number {
  if (selected === from) return to;
  if (from < selected && to >= selected) return selected - 1;
  if (from > selected && to <= selected) return selected + 1;
  return selected;
}

export interface PageMenuAction {
  id: "duplicate" | "delete" | "move-left" | "move-right";
  label: string;
  enabled: boolean;
  reason: string | null;
}

/** El menú «⋯» de cada página, con lo que se puede hacer ahora y por qué no. */
export function pageMenuActions(doc: Pick<DesignDoc, "format" | "pages">, index: number): PageMenuAction[] {
  const blocked = addPageBlockedReason(doc);
  return [
    { id: "duplicate", label: "Duplicar", enabled: blocked === null, reason: blocked },
    { id: "move-left", label: "Mover a la izquierda", enabled: index > 0, reason: index > 0 ? null : "Ya es la primera." },
    { id: "move-right", label: "Mover a la derecha", enabled: index < doc.pages.length - 1, reason: index < doc.pages.length - 1 ? null : "Ya es la última." },
    { id: "delete", label: "Eliminar", enabled: canDeletePage(doc), reason: canDeletePage(doc) ? null : "El diseño necesita al menos una página." },
  ];
}

/** El rótulo de una página en la tira y en el selector: su nombre o «Página N». */
export function pageLabel(doc: Pick<DesignDoc, "pages">, index: number): string {
  return doc.pages[index]?.name?.trim() || `Página ${index + 1}`;
}
