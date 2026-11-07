/**
 * Limpieza de lo que escribe la IA antes de guardarlo (§14a: la IA nunca escribe
 * directo, todo lo que sale de ella se valida y se limpia).
 *
 * La IA no puede escribir HTML: su esquema no tiene elementos `html` y un parche
 * no puede cambiar el `html` ni el `css` de uno cargado (`patch.ts`). Aun así, lo
 * que sale se limpia acá como última barrera: un elemento `html` que no sea
 * IDÉNTICO a uno que ya tenía el documento (el que cargó una persona y ya pasó
 * por la limpieza de HTML al cargarse) se saca. Los textos no se tocan: el render
 * los escapa siempre.
 *
 * Es el ÚNICO lugar por el que pasa todo documento de la IA antes de guardarse
 * (la primera versión, un parche aplicado, una propuesta aceptada): si el
 * documento trae un `sanitizeDocHtml` propio (carga de HTML), se engancha acá.
 *
 * Módulo puro.
 */

import type { DesignDoc } from "../doc/schema";

export interface SanitizedDoc {
  doc: DesignDoc;
  /** Cuántos elementos HTML se sacaron por no ser iguales a los del documento de partida. */
  removed: number;
}

export function sanitizeAiDoc(doc: DesignDoc, base: DesignDoc): SanitizedDoc {
  const known = new Map<string, string>();
  for (const page of base.pages) {
    for (const el of page.elements) if (el.type === "html") known.set(el.id, JSON.stringify([el.html, el.css ?? ""]));
  }
  let removed = 0;
  const pages = doc.pages.map((page) => ({
    ...page,
    elements: page.elements.filter((el) => {
      if (el.type !== "html") return true;
      const same = known.get(el.id) === JSON.stringify([el.html, el.css ?? ""]);
      if (!same) removed++;
      return same;
    }),
  }));
  return removed === 0 ? { doc, removed: 0 } : { doc: { ...doc, pages }, removed };
}
