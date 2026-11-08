/**
 * Limpieza de lo que escribe la IA antes de guardarlo (§14a: la IA nunca escribe directo, todo lo que sale de ella se
 * valida y se limpia). Es el ÚNICO lugar por el que pasa todo documento de la IA antes de guardarse (la primera
 * versión, un parche aplicado, una corrección, una propuesta aceptada).
 *
 * La IA no escribe HTML: su esquema no tiene elementos `html` y un parche no puede cambiar el `html` ni el `css` de un
 * bloque cargado; solo puede cambiar el TEXTO de un nodo marcado (`updateText`). Aun así, acá hay dos barreras:
 *   1. un bloque `html` que no estaba en el documento de partida se saca;
 *   2. con el negocio, todo `html`/`css` vuelve a pasar por `sanitizeDocHtml` (la limpieza de la carga de HTML, DS4):
 *      aunque lo que quedó ya estaba limpio, nunca se guarda sin limpiar.
 * Los textos comunes no se tocan: el render los escapa siempre.
 */

import type { DesignDoc } from "../doc/schema";
import { sanitizeDocHtml } from "../import/edit";

export interface SanitizedDoc {
  doc: DesignDoc;
  /** Cuántos bloques HTML se sacaron por no estar en el documento de partida. */
  removed: number;
}

export function sanitizeAiDoc(doc: DesignDoc, base: DesignDoc, workspaceId?: string): SanitizedDoc {
  // Con el negocio, un bloque que YA estaba en el diseño puede haber cambiado (la IA cambia SOLO textos de un bloque
  // cargado, `updateText`) y pasa por la limpieza; sin el negocio, solo se conserva lo idéntico.
  const kept = keepKnownHtml(doc, base, workspaceId !== undefined);
  if (!workspaceId) return kept;
  const cleaned = sanitizeDocHtml(kept.doc, workspaceId);
  return cleaned.changed ? { doc: cleaned.doc, removed: kept.removed } : kept;
}

function keepKnownHtml(doc: DesignDoc, base: DesignDoc, allowChanged: boolean): SanitizedDoc {
  const known = new Map<string, string>();
  for (const page of base.pages) {
    for (const el of page.elements) if (el.type === "html") known.set(el.id, JSON.stringify([el.html, el.css ?? ""]));
  }
  let removed = 0;
  const pages = doc.pages.map((page) => ({
    ...page,
    elements: page.elements.filter((el) => {
      if (el.type !== "html") return true;
      const before = known.get(el.id);
      const keep = before !== undefined && (allowChanged || before === JSON.stringify([el.html, el.css ?? ""]));
      if (!keep) removed++;
      return keep;
    }),
  }));
  return removed === 0 ? { doc, removed: 0 } : { doc: { ...doc, pages }, removed };
}
