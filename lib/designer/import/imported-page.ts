/**
 * Una página cargada (F42): un elemento `html` que ocupa toda la página. Las capas del editor lo
 * muestran como «Página cargada (HTML)». Módulo puro y liviano (se puede importar desde el navegador).
 */

import type { DesignElement, HtmlElement } from "../doc/schema";

/** Cómo se llama en las capas un elemento que es una página cargada. */
export const IMPORTED_PAGE_NAME = "Página cargada (HTML)";

/** ¿Es un elemento una página cargada (un HTML que ocupa toda la página)? */
export function isImportedPage(el: DesignElement): el is HtmlElement {
  return el.type === "html" && el.w >= 99.9 && (el.h ?? 0) >= 99.9 && Math.abs(el.x - 50) < 0.1 && Math.abs(el.y - 50) < 0.1;
}
