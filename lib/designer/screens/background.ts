/**
 * El fondo de una página y su capa de color (F23): color, degradé o imagen, con el ajuste «Cubrir toda la página» /
 * «Ajustar sin recortar», el punto focal y la capa de color encima de la imagen (con su opacidad de 0 a 90 %).
 *
 * `backgroundLayers(page)` (del render) ordena imagen → capa de color → elementos y corrige la opacidad de la capa al
 * límite (0–90 %): el lienzo y el render dibujan LO MISMO. Acá viven los cambios que hace la pestaña Agregar › Fondo.
 *
 * Módulo puro (inmutable).
 */

import { clamp, isColor } from "../color";
import type { DesignPage, PageBackground } from "../doc/schema";
import { backgroundLayers } from "../render/page-html";

export { backgroundLayers };

/** La capa de color va de 0 a 90 % (más tapa la foto por completo). */
export const MAX_OVERLAY_OPACITY = 0.9;
export const DEFAULT_OVERLAY_OPACITY = 0.45;

/** El fondo cuando se quita: un color liso. */
export const FALLBACK_BACKGROUND = "#ffffff";

const round = (n: number) => Math.round(n * 1000) / 1000;

function withBackground(page: DesignPage, background: PageBackground): DesignPage {
  return { ...page, background };
}

/** Opacidad de 0 a 1 (la del documento) ↔ porcentaje de 0 a 90 (la barra y el número de la pantalla). */
export function overlayOpacityFromPercent(percent: number): number {
  return round(clamp(Math.round(percent), 0, MAX_OVERLAY_OPACITY * 100) / 100);
}

export function overlayPercent(opacity: number): number {
  return Math.round(clamp(opacity, 0, MAX_OVERLAY_OPACITY) * 100);
}

/** Fondo de un color liso. Conserva la capa de color solo si todavía hay una imagen (acá no: se saca). */
export function setBackgroundColor(page: DesignPage, color: string): DesignPage {
  if (!isColor(color)) return page;
  return withBackground(page, { type: "color", color: color.toLowerCase() });
}

/** Fondo en degradé: dos colores y el ángulo (−360 a 360). */
export function setBackgroundGradient(page: DesignPage, gradient: { from: string; to: string; angle: number }): DesignPage {
  if (!isColor(gradient.from) || !isColor(gradient.to)) return page;
  return withBackground(page, { type: "gradient", gradient: { from: gradient.from.toLowerCase(), to: gradient.to.toLowerCase(), angle: Math.round(clamp(gradient.angle, -360, 360)) } });
}

/**
 * Una imagen de fondo (subida o reemplazada): «Cubrir» y el punto focal al centro. Si ya había una, conserva el ajuste,
 * el punto focal y la capa de color: reemplazar la foto no deshace el resto.
 */
export function setBackgroundImage(page: DesignPage, asset: string): DesignPage {
  const current = page.background;
  const image = current.type === "image" && current.image ? { ...current.image, asset } : { asset, fit: "cover" as const, focal: { x: 50, y: 50 }, locked: true };
  return withBackground(page, { type: "image", color: current.color ?? FALLBACK_BACKGROUND, image, ...(current.overlay ? { overlay: current.overlay } : {}) });
}

/** «Cubrir toda la página» (`cover`) o «Ajustar sin recortar» (`contain`). Solo con imagen. */
export function setBackgroundFit(page: DesignPage, fit: "cover" | "contain"): DesignPage {
  const { background } = page;
  if (background.type !== "image" || !background.image || background.image.fit === fit) return page;
  return withBackground(page, { ...background, image: { ...background.image, fit } });
}

/** El punto focal (tocando la imagen), de 0 a 100 en cada eje. Solo con imagen. */
export function setBackgroundFocal(page: DesignPage, focal: { x: number; y: number }): DesignPage {
  const { background } = page;
  if (background.type !== "image" || !background.image) return page;
  return withBackground(page, { ...background, image: { ...background.image, focal: { x: round(clamp(focal.x, 0, 100)), y: round(clamp(focal.y, 0, 100)) } } });
}

/**
 * La capa de color sobre la imagen: color + opacidad (se corrige al límite de 0 a 90 %). Solo con imagen de fondo.
 * Una opacidad de 0 es lo mismo que no tenerla: se quita.
 */
export function setOverlay(page: DesignPage, overlay: { color: string; opacity: number }): DesignPage {
  const { background } = page;
  if (background.type !== "image" || !isColor(overlay.color)) return page;
  const opacity = round(clamp(overlay.opacity, 0, MAX_OVERLAY_OPACITY));
  if (opacity === 0) return clearOverlay(page);
  return withBackground(page, { ...background, overlay: { color: overlay.color.toLowerCase(), opacity } });
}

export function clearOverlay(page: DesignPage): DesignPage {
  if (!page.background.overlay) return page;
  const background = { ...page.background };
  delete background.overlay;
  return withBackground(page, background);
}

/** «Quitar fondo»: vuelve a un color liso (el que tenía de respaldo, o blanco). */
export function removeBackground(page: DesignPage): DesignPage {
  const color = page.background.color && isColor(page.background.color) ? page.background.color : FALLBACK_BACKGROUND;
  return withBackground(page, { type: "color", color });
}

/** El fondo actual como lo describe la pantalla. */
export type BackgroundKind = PageBackground["type"];

export function hasImageBackground(page: DesignPage): boolean {
  return page.background.type === "image" && !!page.background.image;
}

/** Cualquier página del documento con imagen de fondo (el drawer de Configuración ofrece el ajuste solo si hay). */
export function anyImageBackground(pages: readonly DesignPage[]): boolean {
  return pages.some(hasImageBackground);
}

/** Aplica el ajuste de la imagen de fondo a TODAS las páginas que tienen una (Configuración › «Imagen de fondo»). */
export function setFitEverywhere(pages: readonly DesignPage[], fit: "cover" | "contain"): DesignPage[] {
  return pages.map((page) => setBackgroundFit(page, fit));
}

/** El ajuste actual (el de la primera página con imagen), para marcar la opción elegida. */
export function currentFit(pages: readonly DesignPage[]): "cover" | "contain" | null {
  const page = pages.find(hasImageBackground);
  return page?.background.image?.fit ?? null;
}

/** La explicación que acompaña a la capa de color. */
export const OVERLAY_HELP = "Oscurece o aclara la foto para que el texto se lea. La IA la ajusta sola.";
