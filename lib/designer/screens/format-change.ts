/**
 * Cambiar el formato de un diseño (F17, F28): de un tamaño de página a otro.
 *
 * Las posiciones y los anchos están en PORCENTAJE de la página, así que se mantienen; lo que está en píxeles de diseño
 * (tamaño de letra, espaciado, esquinas redondeadas, grosor de bordes) se escala con la razón entre los anchos para que
 * cada elemento se vea del mismo tamaño RELATIVO. Los altos de imágenes y formas, que están en porcentaje del ALTO, se
 * ajustan con la razón entre las proporciones para que no se deformen.
 *
 * Una página web solo cambia por otra web (no hay otra): el desplegable no la mezcla con los demás formatos.
 *
 * Módulo puro (inmutable).
 */

import { clamp } from "../color";
import type { DesignDoc, DesignElement, DesignPage } from "../doc/schema";
import { FORMATS, type FormatKey } from "../formats";

export type FormatChange = { ok: true; doc: DesignDoc } | { ok: false; error: string };

const round = (n: number) => Math.round(n * 100) / 100;

function scaleElement(el: DesignElement, widthRatio: number, heightFactor: number): DesignElement {
  const next: DesignElement = { ...el };
  // Un bloque cargado de HTML ocupa su espacio (casi siempre la página entera): no se reescala.
  if (next.h !== undefined && next.type !== "text" && next.type !== "html") next.h = clamp(round(next.h * heightFactor), 0.1, 100);
  switch (next.type) {
    case "text":
      next.size = Math.round(clamp(next.size * widthRatio, 4, 1000));
      if (next.letterSpacing) next.letterSpacing = round(next.letterSpacing * widthRatio);
      break;
    case "image":
      if (next.radius) next.radius = Math.round(next.radius * widthRatio);
      break;
    case "shape":
      if (next.radius) next.radius = Math.round(next.radius * widthRatio);
      if (next.stroke) next.stroke = { ...next.stroke, width: round(next.stroke.width * widthRatio) };
      break;
    case "html":
      break;
  }
  return next;
}

/** El documento pasado a otro formato: mismos elementos en las mismas posiciones relativas, con las medidas en px escaladas. */
export function convertDocFormat(doc: DesignDoc, to: FormatKey): FormatChange {
  if (doc.format === to) return { ok: true, doc };
  if ((doc.format === "web") !== (to === "web")) return { ok: false, error: "Una página web solo se cambia por otra página web." };
  const from = FORMATS[doc.format];
  const target = FORMATS[to];
  const widthRatio = target.width / from.width;
  // El alto de un elemento está en % del alto de la página: su alto en px (alto% × alto de la página) también se
  // escala con la razón de anchos, y de ahí sale el porcentaje sobre el alto nuevo. Así no se deforma.
  const factor = (from.height * widthRatio) / target.height;
  const pages: DesignPage[] = doc.pages.map((page) => ({ ...page, elements: page.elements.map((el) => scaleElement(el, widthRatio, factor)) }));
  return { ok: true, doc: { ...doc, format: to, pages } };
}
