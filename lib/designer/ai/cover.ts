/**
 * La primera versión con fotos (F33): la imagen de la portada y su capa de color.
 *
 * Con imágenes adjuntas en un carrusel o una historia, la PRIMERA va de fondo
 * de la portada, con una capa de color calculada para llegar al contraste
 * mínimo. La IA propone, pero esto lo garantiza el servidor: sin importar lo
 * que devuelva el modelo, la portada queda con la foto y con una capa que
 * alcanza (con la luminancia de la foto desconocida se calcula para el peor
 * caso razonable, un gris medio; después la revisión automática mide la foto
 * real y la ajusta).
 *
 * Módulo puro.
 */

import { minContrastFor, overlayForContrast, relativeLuminance } from "../color";
import type { DesignDoc, DesignPage, TextElement } from "../doc/schema";
import { FORMATS, type FormatKey } from "../formats";
import { COVER_IMAGE_FORMATS } from "./rules";

/** La luminancia que se supone de una foto que todavía no se midió: un gris medio. */
export const ASSUMED_PHOTO_LUMINANCE = 0.5;

/** Con imágenes adjuntas en un formato de redes, la primera va de fondo de la portada. */
export function applyCoverImage(doc: DesignDoc, attachments: readonly string[], format: FormatKey): DesignDoc {
  if (attachments.length === 0 || !COVER_IMAGE_FORMATS.includes(format) || doc.pages.length === 0) return doc;
  const next = structuredClone(doc);
  const cover = next.pages[0];
  const current = cover.background.type === "image" ? cover.background.image : undefined;
  cover.background = {
    type: "image",
    image: { asset: attachments[0], fit: current?.fit ?? "cover", focal: current?.focal ?? { x: 50, y: 50 }, locked: false },
    ...(cover.background.overlay ? { overlay: cover.background.overlay } : {}),
  };
  return next;
}

function visibleTexts(page: DesignPage): TextElement[] {
  return page.elements.filter((e): e is TextElement => e.type === "text" && !e.hidden);
}

/**
 * En cada página con foto de fondo y textos, asegura una capa de color con la
 * opacidad que alcanza el contraste mínimo para el peor texto. Nunca baja una
 * capa que ya es más fuerte.
 */
export function ensureOverlays(doc: DesignDoc, format: FormatKey, onlyPages?: readonly number[]): DesignDoc {
  const def = FORMATS[format];
  const next = structuredClone(doc);
  for (const [index, page] of next.pages.entries()) {
    if (onlyPages && !onlyPages.includes(index)) continue;
    if (page.background.type !== "image") continue;
    const texts = visibleTexts(page);
    if (texts.length === 0) continue;
    const lightest = texts.reduce((a, b) => (relativeLuminance(b.color) > relativeLuminance(a.color) ? b : a));
    const overlayColor = page.background.overlay?.color ?? (relativeLuminance(lightest.color) < 0.4 ? "#ffffff" : "#0f1115");
    let wanted = 0;
    for (const el of texts) {
      const needed = overlayForContrast(el.color, ASSUMED_PHOTO_LUMINANCE, overlayColor, minContrastFor(el.size, def.minFontSize));
      wanted = Math.max(wanted, needed ?? 0.9);
    }
    const current = page.background.overlay?.opacity ?? 0;
    if (wanted > current) page.background.overlay = { color: overlayColor, opacity: Math.min(0.9, wanted) };
  }
  return next;
}
