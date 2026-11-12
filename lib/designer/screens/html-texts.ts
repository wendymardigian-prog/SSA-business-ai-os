/**
 * Los textos de un HTML cargado, editados a mano (F42): al importar, cada texto queda marcado con `data-tx`
 * (`markEditableText`). Esto arma lo que necesitan el lienzo y la pestaña Capas para tocarlos uno por uno.
 *
 * - `htmlTextRows`: las sub-filas de Capas debajo de «Página cargada (HTML)».
 * - `htmlTextOf`: el texto guardado de una marca (con sus `{{variables}}`), para empezar a escribir.
 * - `applyHtmlText`: el elemento con ESE texto cambiado; lo demás del HTML queda igual. Lo que se escribe nunca se
 *   lee como HTML (`replaceNodeText` lo escapa) y el servidor vuelve a limpiar todo al guardar (`sanitizeDocHtml`).
 * - `designPoint` / `designBox`: de la pantalla a los px del diseño, para ubicar un texto dentro del iframe.
 *
 * Módulo puro (se usa desde el navegador).
 */

import type { HtmlElement } from "../doc/schema";
import { listEditableTexts, replaceNodeText } from "../import/mark-text";

export interface HtmlTextRow {
  /** El `data-tx` del texto. */
  tx: string;
  name: string;
}

const VARIABLE = /\{\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\}\}/g;
const MAX_NAME = 40;

/** Cómo se nombra un texto en Capas: las variables como `[Etiqueta]`, en una línea y recortado. */
export function htmlTextName(text: string, variableLabel: (key: string) => string = (key) => key): string {
  const flat = text.replace(VARIABLE, (_m, key: string) => `[${variableLabel(key)}]`).replace(/\s+/g, " ").trim();
  if (!flat) return "Texto vacío";
  return flat.length > MAX_NAME ? `${flat.slice(0, MAX_NAME)}…` : flat;
}

/** Las sub-filas de un bloque HTML: un texto marcado por fila, en el orden en que aparecen. */
export function htmlTextRows(el: Pick<HtmlElement, "html">, variableLabel?: (key: string) => string): HtmlTextRow[] {
  return listEditableTexts(el.html).map((item) => ({ tx: item.id, name: htmlTextName(item.text, variableLabel) }));
}

/** El texto guardado de una marca, o `null` si ya no existe. */
export function htmlTextOf(el: Pick<HtmlElement, "html">, tx: string): string | null {
  return listEditableTexts(el.html).find((item) => item.id === tx)?.text ?? null;
}

/** El elemento con el texto de la marca `tx` reemplazado. El MISMO elemento si no cambió nada o la marca no existe. */
export function applyHtmlText<T extends HtmlElement>(el: T, tx: string, text: string): T {
  if (htmlTextOf(el, tx) === text) return el;
  const html = replaceNodeText(el.html, tx, text);
  return html === null || html === el.html ? el : { ...el, html };
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Un punto de la pantalla en px del diseño. El iframe del bloque mide lo mismo que la página y no está escalado por
 * dentro: el `scale` lo lleva la página que lo contiene.
 */
export function designPoint(client: ScreenPoint, page: Pick<ScreenBox, "left" | "top">, scale: number): ScreenPoint {
  const s = scale > 0 ? scale : 1;
  return { x: (client.x - page.left) / s, y: (client.y - page.top) / s };
}

/** El recuadro de un texto (ya en px del diseño), con un margen chico para que no tape las letras. `null` si no se ve. */
export function designBox(rect: ScreenBox, pad = 3): ScreenBox | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
}
