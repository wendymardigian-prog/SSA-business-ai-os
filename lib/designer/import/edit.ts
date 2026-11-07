/**
 * Lo que se guarda de un HTML cargado, siempre limpio (F40, F42): una edición de la persona o un
 * parche de la IA que mete un `<script>` queda limpio al guardar.
 *
 *   - `setNodeText`: cambia el texto de UN nodo marcado y vuelve a limpiar todo.
 *   - `sanitizeDocHtml`: vuelve a limpiar el HTML y el CSS de todos los elementos `html` de un documento
 *     (lo que llama el guardado del editor y el que aplica los parches de la IA).
 *
 * Solo servidor.
 */

import type { DesignDoc, DesignElement, HtmlElement } from "../doc/schema";
import { pathBelongsTo } from "../storage";
import { sanitizeCss, type AssetRef } from "./css";
import { replaceNodeText } from "./mark-text";
import { EMPTY_REMOVED, sanitizeImportedHtml, type RemovedCounts } from "./sanitize";

/** `asset:` de este negocio: lo único que se acepta al volver a limpiar algo ya cargado. */
export function ownAssetRef(workspaceId: string): AssetRef {
  return (url) => {
    if (/^data:image\//i.test(url)) return url;
    if (!url.startsWith("asset:")) return null;
    return pathBelongsTo(url.slice("asset:".length), workspaceId) ? url : null;
  };
}

/** Cambia el texto de UN nodo marcado y vuelve a limpiar todo. Devuelve `null` si no existe ese nodo. Lo demás queda igual. */
export function setNodeText(html: string, id: string, text: string, assetRef: AssetRef): string | null {
  const next = replaceNodeText(html, id, text);
  if (next === null) return null;
  return sanitizeImportedHtml(next, { assetRef, keepMarks: true }).html;
}

export interface SanitizeDocResult {
  doc: DesignDoc;
  /** Si la limpieza cambió algo (el HTML o el CSS de algún elemento). */
  changed: boolean;
  removed: RemovedCounts;
}

/**
 * Vuelve a limpiar el HTML y el CSS de TODOS los elementos `html` de un documento. No toca los
 * elementos de texto, imagen ni forma.
 */
export function sanitizeDocHtml(doc: DesignDoc, workspaceId: string): SanitizeDocResult {
  const assetRef = ownAssetRef(workspaceId);
  const removed: RemovedCounts = { ...EMPTY_REMOVED };
  let changed = false;
  const pages = doc.pages.map((page) => ({
    ...page,
    elements: page.elements.map((el): DesignElement => {
      if (el.type !== "html") return el;
      const cleaned = sanitizeImportedHtml(el.html, { assetRef, keepMarks: true });
      const css = el.css !== undefined ? sanitizeCss(el.css, { assetRef }) : null;
      removed.scripts += cleaned.removed.scripts;
      removed.iframes += cleaned.removed.iframes;
      removed.forms += cleaned.removed.forms;
      removed.other += cleaned.removed.other + (css?.removed ?? 0);
      removed.videos += cleaned.removed.videos;
      const nextCss = css ? css.css : el.css;
      if (cleaned.html !== el.html || nextCss !== el.css) changed = true;
      const next: HtmlElement = { ...el, html: cleaned.html };
      if (nextCss !== undefined) next.css = nextCss;
      return next;
    }),
  }));
  return { doc: { ...doc, pages }, changed, removed };
}
