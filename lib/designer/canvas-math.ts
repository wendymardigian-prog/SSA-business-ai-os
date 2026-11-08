/**
 * La matemática del lienzo (F14): imanes, mover con el teclado, cambiar el
 * tamaño, rotar y alinear a la página.
 *
 * Todo en PORCENTAJE de la página, con el centro del elemento (como el
 * documento). El lienzo NO calcula posiciones por su cuenta: llama a estas
 * funciones (lo controla un test de frontera del editor, F19).
 *
 * La tolerancia de los imanes es de 6 px DE PANTALLA: a más zoom, más fina en
 * la página. Se convierte con la escala (px de pantalla por px de diseño).
 *
 * Módulo puro.
 */

import { clamp } from "./color";
import type { SafeZone } from "./formats";

/** Una caja con centro (x, y) y tamaño (w, h), todo en % de la página. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type GuideKind = "center" | "element" | "margin" | "edge";

/** Una guía para dibujar: rosa para centro y otros elementos, celeste para márgenes (F19). */
export interface Guide {
  axis: "x" | "y";
  /** Posición de la línea en % de la página. */
  at: number;
  kind: GuideKind;
}

export const SNAP_TOLERANCE_SCREEN_PX = 6;

export interface SnapInput {
  /** La caja que se mueve, con la posición propuesta (el centro). */
  box: Box;
  /** Las otras cajas visibles de la página. */
  others: readonly Box[];
  safeZone: SafeZone;
  /** Tamaño de la página en px de diseño. */
  pageSize: { width: number; height: number };
  /** px de pantalla por px de diseño (zoom). */
  scale: number;
  /** Alt presionado: sin imanes. */
  disabled?: boolean;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: Guide[];
}

interface Candidate {
  /** El centro que tendría el elemento si se pega. */
  center: number;
  /** Dónde se dibuja la guía. */
  line: number;
  kind: GuideKind;
}

const KIND_PRIORITY: Record<GuideKind, number> = { center: 0, margin: 1, element: 2, edge: 3 };

function candidatesFor(axis: "x" | "y", size: number, others: readonly Box[], safe: SafeZone): Candidate[] {
  const half = size / 2;
  const startMargin = axis === "x" ? safe.left : safe.top;
  const endMargin = 100 - (axis === "x" ? safe.right : safe.bottom);
  const list: Candidate[] = [
    { center: 50, line: 50, kind: "center" },
    { center: startMargin + half, line: startMargin, kind: "margin" },
    { center: endMargin - half, line: endMargin, kind: "margin" },
    { center: half, line: 0, kind: "edge" },
    { center: 100 - half, line: 100, kind: "edge" },
  ];
  for (const other of others) {
    const c = axis === "x" ? other.x : other.y;
    const s = axis === "x" ? other.w : other.h;
    const start = c - s / 2;
    const end = c + s / 2;
    // Centro con centro, y bordes con bordes (los dos lados de cada uno).
    list.push({ center: c, line: c, kind: "element" });
    for (const edge of [start, end]) {
      list.push({ center: edge + half, line: edge, kind: "element" });
      list.push({ center: edge - half, line: edge, kind: "element" });
    }
  }
  return list;
}

function snapAxis(axis: "x" | "y", value: number, size: number, others: readonly Box[], safe: SafeZone, tolerance: number): { value: number; guide: Guide | null } {
  let best: Candidate | null = null;
  let bestDistance = Infinity;
  for (const cand of candidatesFor(axis, size, others, safe)) {
    const distance = Math.abs(cand.center - value);
    if (distance > tolerance) continue;
    if (distance < bestDistance - 1e-9 || (Math.abs(distance - bestDistance) <= 1e-9 && best && KIND_PRIORITY[cand.kind] < KIND_PRIORITY[best.kind])) {
      best = cand;
      bestDistance = distance;
    }
  }
  if (!best) return { value, guide: null };
  return { value: best.center, guide: { axis, at: best.line, kind: best.kind } };
}

/** La tolerancia de los imanes en % de la página para cada eje. */
export function snapTolerance(pageSize: { width: number; height: number }, scale: number): { x: number; y: number } {
  const designPx = SNAP_TOLERANCE_SCREEN_PX / Math.max(scale, 0.01);
  return { x: (designPx / pageSize.width) * 100, y: (designPx / pageSize.height) * 100 };
}

/**
 * Ajusta la posición propuesta a los imanes: centro de la página, márgenes de
 * seguridad, bordes de la página y bordes y centros de los otros elementos.
 * Se pega en cada eje por separado (puede pegarse en x y en y a la vez).
 */
export function snap(input: SnapInput): SnapResult {
  if (input.disabled) return { x: input.box.x, y: input.box.y, guides: [] };
  const tol = snapTolerance(input.pageSize, input.scale);
  const sx = snapAxis("x", input.box.x, input.box.w, input.others, input.safeZone, tol.x);
  const sy = snapAxis("y", input.box.y, input.box.h, input.others, input.safeZone, tol.y);
  return { x: sx.value, y: sy.value, guides: [sx.guide, sy.guide].filter((g): g is Guide => g !== null) };
}

export type NudgeDirection = "left" | "right" | "up" | "down";

/** Mover con las flechas: 0,5 % por toque, 2 % con Shift. El centro queda en 0–100. */
export function nudge(pos: { x: number; y: number }, direction: NudgeDirection, big = false): { x: number; y: number } {
  const step = big ? 2 : 0.5;
  const dx = direction === "left" ? -step : direction === "right" ? step : 0;
  const dy = direction === "up" ? -step : direction === "down" ? step : 0;
  return { x: round(clamp(pos.x + dx, 0, 100)), y: round(clamp(pos.y + dy, 0, 100)) };
}

/**
 * Cambiar el ancho desde un lado: el lado opuesto queda quieto (por eso se mueve
 * el centro). `delta` en % de la página, positivo hacia afuera. Ancho mínimo 1 %.
 */
export function resizeWidth(box: Pick<Box, "x" | "w">, side: "left" | "right", delta: number): { x: number; w: number } {
  const w = clamp(box.w + delta, 1, 100);
  const applied = w - box.w;
  const x = side === "right" ? box.x + applied / 2 : box.x - applied / 2;
  return { x: round(x), w: round(w) };
}

/** Lo mismo para el alto (imágenes y formas). */
export function resizeHeight(box: Pick<Box, "y" | "h">, side: "top" | "bottom", delta: number): { y: number; h: number } {
  const h = clamp(box.h + delta, 1, 100);
  const applied = h - box.h;
  const y = side === "bottom" ? box.y + applied / 2 : box.y - applied / 2;
  return { y: round(y), h: round(h) };
}

/** La esquina de un texto: el tamaño de letra crece en proporción al ancho (4–1000 px). */
export function resizeFont(size: number, factor: number): number {
  return Math.round(clamp(size * factor, 4, 1000));
}

/** La esquina de una imagen: escala ancho y alto manteniendo la proporción. */
export function scaleBox(box: Box, factor: number): Box {
  const f = Math.max(factor, 0.01);
  const w = clamp(box.w * f, 1, 100);
  const real = w / box.w;
  return { x: box.x, y: box.y, w: round(w), h: round(clamp(box.h * real, 1, 100)) };
}

/** El ángulo del asa de rotación, con pasos de 15° si se aprieta Shift. Normalizado a −180…180. */
export function rotate(angle: number, shift = false): number {
  let a = shift ? Math.round(angle / 15) * 15 : Math.round(angle * 10) / 10;
  a = ((((a + 180) % 360) + 360) % 360) - 180;
  return a === -180 ? 180 : a;
}

/** El ángulo del puntero respecto del centro del elemento (para el asa de rotación), en grados; 0 = arriba. */
export function pointerAngle(center: { x: number; y: number }, pointer: { x: number; y: number }): number {
  const rad = Math.atan2(pointer.x - center.x, -(pointer.y - center.y));
  return (rad * 180) / Math.PI;
}

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** Alinear a la página (F14, F21): cada elemento seleccionado contra los bordes o el centro de la página. */
export function alignSelection(boxes: readonly Box[], mode: AlignMode): Box[] {
  return boxes.map((b) => {
    switch (mode) {
      case "left":
        return { ...b, x: round(b.w / 2) };
      case "center":
        return { ...b, x: 50 };
      case "right":
        return { ...b, x: round(100 - b.w / 2) };
      case "top":
        return { ...b, y: round(b.h / 2) };
      case "middle":
        return { ...b, y: 50 };
      case "bottom":
        return { ...b, y: round(100 - b.h / 2) };
    }
  });
}

/** Si dos cajas se tocan (para la selección con rectángulo). */
export function intersects(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
}

/** De px de pantalla (dentro del lienzo) a % de la página. */
export function screenToPct(delta: { dx: number; dy: number }, pageSize: { width: number; height: number }, scale: number): { dx: number; dy: number } {
  const s = Math.max(scale, 0.01);
  return { dx: (delta.dx / s / pageSize.width) * 100, dy: (delta.dy / s / pageSize.height) * 100 };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
