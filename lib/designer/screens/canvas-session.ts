/**
 * Los gestos del lienzo (F19): mover, cambiar el tamaño desde un lado o una esquina y rotar.
 *
 * Es la ÚNICA puerta entre el puntero y `canvas-math`: el componente del lienzo solo le pasa dónde está el puntero y
 * pinta lo que vuelve (parches de posición y guías); no calcula posiciones por su cuenta (lo controla
 * `components/designer/canvas/canvas-boundary.test.ts`).
 *
 * Todo en porcentaje de la página, con el centro del elemento, como el documento. La conversión de píxeles de pantalla a
 * porcentaje usa la escala del zoom (`screenToPct`). Funciona igual con mouse, lápiz y dedo: son Pointer Events y acá
 * solo llegan coordenadas.
 *
 * Módulo puro.
 */

import { nudge, pointerAngle, resizeFont, resizeHeight, resizeWidth, rotate, scaleBox, screenToPct, snap, type Box, type Guide, type NudgeDirection } from "../canvas-math";
import { clamp } from "../color";
import type { DesignElement } from "../doc/schema";
import type { SafeZone } from "../formats";
import type { ElementPatch } from "./doc-ops";

export interface Point {
  x: number;
  y: number;
}

export interface PageGeometry {
  /** Tamaño de diseño de la página, en px. */
  width: number;
  height: number;
  /** px de pantalla por px de diseño (el zoom). */
  scale: number;
  safeZone: SafeZone;
}

/** Hasta cuántos px de pantalla un toque sigue siendo un clic y no un arrastre. */
export const DRAG_THRESHOLD_PX = 3;

export interface GestureResult {
  patches: Record<string, ElementPatch>;
  guides: Guide[];
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const pct = (n: number) => round(clamp(n, 0, 100));

function pixelsMoved(from: Point, to: Point): number {
  return Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
}

function deltaPct(geometry: PageGeometry, from: Point, to: Point): { dx: number; dy: number } {
  return screenToPct({ dx: to.x - from.x, dy: to.y - from.y }, { width: geometry.width, height: geometry.height }, geometry.scale);
}

// ─── Mover ───────────────────────────────────────────────────────────────────

export interface MoveSession {
  kind: "move";
  geometry: PageGeometry;
  pointer0: Point;
  origins: Record<string, { x: number; y: number }>;
  /** La caja que envuelve a todo lo que se mueve: es la que se pega a los imanes. */
  union: Box;
  /** Las cajas de lo que NO se mueve (los demás elementos visibles). */
  others: Box[];
  moved: boolean;
}

/**
 * Empieza a mover. `boxes` son las cajas de los elementos que SE MUEVEN (sin los bloqueados) y `others` las de los demás
 * elementos visibles de la página.
 */
export function startMove(input: { geometry: PageGeometry; pointer: Point; boxes: Readonly<Record<string, Box>>; others: readonly Box[] }): MoveSession | null {
  const entries = Object.entries(input.boxes);
  if (entries.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const origins: MoveSession["origins"] = {};
  for (const [id, b] of entries) {
    origins[id] = { x: b.x, y: b.y };
    left = Math.min(left, b.x - b.w / 2);
    right = Math.max(right, b.x + b.w / 2);
    top = Math.min(top, b.y - b.h / 2);
    bottom = Math.max(bottom, b.y + b.h / 2);
  }
  return {
    kind: "move",
    geometry: input.geometry,
    pointer0: input.pointer,
    origins,
    union: { x: (left + right) / 2, y: (top + bottom) / 2, w: right - left, h: bottom - top },
    others: [...input.others],
    moved: false,
  };
}

/**
 * El puntero se movió. Devuelve `null` mientras el movimiento no pasó el umbral (sigue siendo un clic). Con Alt apretado
 * no hay imanes. Los imanes: centro de la página, márgenes de seguridad, bordes y centros de los otros elementos.
 */
export function updateMove(session: MoveSession, pointer: Point, mods: { alt: boolean }): { session: MoveSession; result: GestureResult } | null {
  if (!session.moved && pixelsMoved(session.pointer0, pointer) <= DRAG_THRESHOLD_PX) return null;
  const { dx, dy } = deltaPct(session.geometry, session.pointer0, pointer);
  const proposed: Box = { ...session.union, x: session.union.x + dx, y: session.union.y + dy };
  const snapped = snap({
    box: proposed,
    others: session.others,
    safeZone: session.geometry.safeZone,
    pageSize: { width: session.geometry.width, height: session.geometry.height },
    scale: session.geometry.scale,
    disabled: mods.alt,
  });
  const appliedX = snapped.x - session.union.x;
  const appliedY = snapped.y - session.union.y;
  const patches: Record<string, ElementPatch> = {};
  for (const [id, origin] of Object.entries(session.origins)) patches[id] = { x: pct(origin.x + appliedX), y: pct(origin.y + appliedY) };
  return { session: session.moved ? session : { ...session, moved: true }, result: { patches, guides: snapped.guides } };
}

// ─── Cambiar el tamaño ───────────────────────────────────────────────────────

export type SideHandle = "left" | "right" | "top" | "bottom";

export interface SideSession {
  kind: "side";
  geometry: PageGeometry;
  pointer0: Point;
  id: string;
  side: SideHandle;
  box: Box;
  moved: boolean;
}

export function startSide(input: { geometry: PageGeometry; pointer: Point; id: string; side: SideHandle; box: Box }): SideSession {
  return { kind: "side", geometry: input.geometry, pointer0: input.pointer, id: input.id, side: input.side, box: input.box, moved: false };
}

/**
 * Cambia el ancho (lados izquierdo y derecho) o el alto (arriba y abajo, solo imágenes, formas y bloques) con el lado
 * opuesto quieto. Un texto solo cambia de ancho: su alto es automático.
 */
export function updateSide(session: SideSession, pointer: Point): { session: SideSession; result: GestureResult } {
  const { dx, dy } = deltaPct(session.geometry, session.pointer0, pointer);
  const patches: Record<string, ElementPatch> = {};
  if (session.side === "left" || session.side === "right") {
    const next = resizeWidth(session.box, session.side, session.side === "right" ? dx : -dx);
    patches[session.id] = { x: pct(next.x), w: next.w };
  } else {
    const next = resizeHeight(session.box, session.side, session.side === "bottom" ? dy : -dy);
    patches[session.id] = { y: pct(next.y), h: next.h };
  }
  return { session: { ...session, moved: true }, result: { patches, guides: [] } };
}

export interface CornerSession {
  kind: "corner";
  geometry: PageGeometry;
  pointer0: Point;
  id: string;
  box: Box;
  /** Un texto cambia el tamaño de la LETRA en proporción; lo demás se escala manteniendo la proporción. */
  fontSize: number | null;
  moved: boolean;
}

export function startCorner(input: { geometry: PageGeometry; pointer: Point; id: string; box: Box; fontSize?: number | null }): CornerSession {
  return { kind: "corner", geometry: input.geometry, pointer0: input.pointer, id: input.id, box: input.box, fontSize: input.fontSize ?? null, moved: false };
}

/**
 * La esquina de abajo a la derecha: en textos, el tamaño de letra proporcional; en imágenes y formas, la escala con la
 * misma proporción. La esquina de arriba a la izquierda queda quieta.
 */
export function updateCorner(session: CornerSession, pointer: Point): { session: CornerSession; result: GestureResult } {
  const { dx } = deltaPct(session.geometry, session.pointer0, pointer);
  const width = clamp(session.box.w + dx, 1, 100);
  const factor = width / session.box.w;
  const patch: ElementPatch = {};
  if (session.fontSize !== null) {
    const h = session.box.h * factor;
    patch.w = round(width);
    patch.size = resizeFont(session.fontSize, factor);
    patch.x = pct(session.box.x + (width - session.box.w) / 2);
    patch.y = pct(session.box.y + (h - session.box.h) / 2);
  } else {
    const scaled = scaleBox(session.box, factor);
    patch.w = scaled.w;
    patch.h = scaled.h;
    patch.x = pct(session.box.x + (scaled.w - session.box.w) / 2);
    patch.y = pct(session.box.y + (scaled.h - session.box.h) / 2);
  }
  return { session: { ...session, moved: true }, result: { patches: { [session.id]: patch }, guides: [] } };
}

// ─── Rotar ───────────────────────────────────────────────────────────────────

export interface RotateSession {
  kind: "rotate";
  id: string;
  /** El centro del elemento en px de pantalla (lo mide el lienzo al empezar). */
  center: Point;
  moved: boolean;
}

export function startRotate(input: { id: string; center: Point }): RotateSession {
  return { kind: "rotate", id: input.id, center: input.center, moved: false };
}

/** El asa de rotación (arriba): el ángulo sale de dónde está el puntero respecto del centro; con Shift, de a 15°. */
export function updateRotate(session: RotateSession, pointer: Point, mods: { shift: boolean }): { session: RotateSession; result: GestureResult } {
  const rotation = rotate(pointerAngle(session.center, pointer), mods.shift);
  return { session: { ...session, moved: true }, result: { patches: { [session.id]: { rotation: rotation === 0 ? undefined : rotation } }, guides: [] } };
}

// ─── Teclado ─────────────────────────────────────────────────────────────────

/** Mover con las flechas: 0,5 % por toque, 2 % con Shift. No mueve lo bloqueado. */
export function keyboardNudge(elements: readonly Pick<DesignElement, "id" | "x" | "y" | "locked">[], direction: NudgeDirection, big: boolean): Record<string, ElementPatch> {
  const patches: Record<string, ElementPatch> = {};
  for (const el of elements) {
    if (el.locked) continue;
    patches[el.id] = nudge({ x: el.x, y: el.y }, direction, big);
  }
  return patches;
}

// ─── Qué asas se dibujan ─────────────────────────────────────────────────────

export type HandleId = "left" | "right" | "top" | "bottom" | "corner" | "rotate";

/**
 * Las asas de un elemento seleccionado. Un bloqueado no tiene ninguna. Un texto: lados (ancho), esquina (letra) y
 * rotación. Imágenes y formas: todo. Una línea: ancho y rotación. Un bloque cargado de HTML: lados y esquina, sin
 * rotación.
 */
export function handlesFor(el: Pick<DesignElement, "type" | "locked"> & { shape?: string }): HandleId[] {
  if (el.locked) return [];
  switch (el.type) {
    case "text":
      return ["left", "right", "corner", "rotate"];
    case "image":
      return ["left", "right", "top", "bottom", "corner", "rotate"];
    case "shape":
      return el.shape === "line" ? ["left", "right", "rotate"] : ["left", "right", "top", "bottom", "corner", "rotate"];
    case "html":
      return ["left", "right", "top", "bottom", "corner"];
  }
}

/** El `inset` CSS de la zona segura (celeste y punteada mientras se arrastra), a partir de los márgenes del formato. */
export function safeInset(safe: SafeZone): string {
  return `${round(safe.top)}% ${round(safe.right)}% ${round(safe.bottom)}% ${round(safe.left)}%`;
}

/** La posición de una guía como estilo CSS (porcentaje), para el eje que corresponde. */
export function guideStyle(guide: Guide): Record<string, string> {
  return guide.axis === "x" ? { left: `${round(guide.at)}%`, top: "0", bottom: "0", width: "0" } : { top: `${round(guide.at)}%`, left: "0", right: "0", height: "0" };
}

/** Las guías de márgenes de seguridad son celestes y punteadas; las del centro y de otros elementos, rosa. */
export function guideTone(guide: Guide): "pink" | "cyan" {
  return guide.kind === "margin" ? "cyan" : "pink";
}
