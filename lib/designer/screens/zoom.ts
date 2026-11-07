/**
 * El zoom del lienzo (F18): Ajustar · 50 · 100 · 200 %, con Ctrl/⌘ + rueda, y el pellizco en el celular.
 *
 * `100 %` es un píxel de pantalla por píxel de diseño. «Ajustar» entra la página completa en el espacio disponible; una
 * página web se ajusta por el ancho (su alto es libre y se desplaza).
 *
 * Módulo puro.
 */

import { clamp } from "../color";

export const ZOOM_MODES = ["fit", 50, 100, 200] as const;
export type ZoomMode = (typeof ZOOM_MODES)[number];

export const ZOOM_LABELS: Record<string, string> = { fit: "Ajustar", "50": "50 %", "100": "100 %", "200": "200 %" };

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 4;

export interface Size {
  width: number;
  height: number;
}

/** La escala (px de pantalla por px de diseño) para un modo, con el espacio disponible y el tamaño de la página. */
export function zoomScale(mode: ZoomMode, viewport: Size, page: Size, opts: { padding?: number; fitWidthOnly?: boolean } = {}): number {
  if (mode !== "fit") return mode / 100;
  const padding = opts.padding ?? 44;
  const availableWidth = Math.max(viewport.width - padding, 80);
  const availableHeight = Math.max(viewport.height - padding, 80);
  const byWidth = availableWidth / page.width;
  const scale = opts.fitWidthOnly ? byWidth : Math.min(byWidth, availableHeight / page.height);
  return clamp(scale, MIN_SCALE, MAX_SCALE);
}

/** Con Ctrl/⌘ + rueda: hacia arriba acerca al nivel siguiente y hacia abajo aleja al anterior (entre 50, 100 y 200). */
export function wheelZoom(mode: ZoomMode, deltaY: number): ZoomMode {
  const steps: ZoomMode[] = [50, 100, 200];
  const index = steps.indexOf(mode);
  if (index < 0) return deltaY < 0 ? 100 : 50;
  const next = clamp(index + (deltaY < 0 ? 1 : -1), 0, steps.length - 1);
  return steps[next];
}

/** El pellizco: la escala sigue a la distancia entre los dos dedos. */
export function pinchScale(startScale: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return startScale;
  return clamp(startScale * (distance / startDistance), MIN_SCALE, MAX_SCALE);
}

/** La inversa de la escala: para que las asas y los textos de la selección no crezcan ni se achiquen con el zoom. */
export function inverseScale(scale: number): number {
  return 1 / Math.max(scale, MIN_SCALE);
}

/** El tamaño que ocupa la página ya escalada. */
export function scaledSize(page: Size, scale: number): Size {
  return { width: Math.round(page.width * scale), height: Math.round(page.height * scale) };
}
