/**
 * Los documentos con los que empieza un diseño (F30, F16) y los elementos que se agregan desde «Agregar» (F22).
 *
 * - **En blanco:** una página con el fondo del color de la marca y un texto «Escribí acá».
 * - **Desde una imagen:** la imagen subida queda como fondo BLOQUEADO de la página 1, con ajuste «Cubrir»
 *   (`background.type = image` y `locked = true`), para ponerle encima textos y variables.
 * - **Con IA:** una página vacía con el color de la marca; la IA arma el resto (DS3).
 *
 * Los tamaños de letra salen del formato (un título en una historia no mide lo que en una carta).
 *
 * Módulo puro.
 */

import { contrastRatio, isColor } from "../color";
import { newId, type DesignDoc, type DesignPage, type ImageElement, type ShapeElement, type TextElement } from "../doc/schema";
import { FORMATS, type FormatKey } from "../formats";

export const PLACEHOLDER_TEXT = "Escribí acá";
/** El fondo cuando el negocio no tiene color de marca. */
export const DEFAULT_PAGE_BACKGROUND = "#ffffff";
const DARK_TEXT = "#111111";
const LIGHT_TEXT = "#ffffff";

export type TextRole = "title" | "subtitle" | "body";

export const TEXT_ROLE_LABELS: Record<TextRole, string> = { title: "Título", subtitle: "Subtítulo", body: "Cuerpo" };

const TEXT_RATIOS: Record<TextRole, number> = { title: 0.07, subtitle: 0.045, body: 0.03 };

/** Los tamaños de letra (px de diseño) de título, subtítulo y cuerpo según el formato; el cuerpo nunca baja del mínimo legible. */
export function textSizes(format: FormatKey): Record<TextRole, number> {
  const def = FORMATS[format];
  const size = (role: TextRole) => Math.max(role === "body" ? def.minFontSize : Math.round(def.minFontSize * 1.2), Math.round(def.width * TEXT_RATIOS[role]));
  return { title: size("title"), subtitle: size("subtitle"), body: size("body") };
}

/** El color de texto que se lee sobre un fondo (el de más contraste entre un oscuro y uno claro). */
export function readableTextColor(background: string | null | undefined): string {
  if (!background || !isColor(background)) return DARK_TEXT;
  return contrastRatio(background, LIGHT_TEXT) >= contrastRatio(background, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

const ROLE_TEXT: Record<TextRole, string> = { title: "Título", subtitle: "Subtítulo", body: "Escribí tu texto acá" };

export interface NewTextOptions {
  text?: string;
  color?: string;
  family?: string;
  weight?: number;
  /** Centro del elemento, en % de la página. Por defecto, el centro. */
  at?: { x: number; y: number };
}

/** Un texto nuevo, centrado en la página, con el tamaño que pide el formato. */
export function newTextElement(format: FormatKey, role: TextRole, opts: NewTextOptions = {}): TextElement {
  const sizes = textSizes(format);
  return {
    id: newId("el"),
    type: "text",
    x: opts.at?.x ?? 50,
    y: opts.at?.y ?? 50,
    w: role === "body" ? 76 : 80,
    text: opts.text ?? ROLE_TEXT[role],
    font: { family: opts.family ?? "Inter", weight: opts.weight ?? (role === "body" ? 400 : 700) },
    size: sizes[role],
    align: role === "body" ? "left" : "center",
    color: opts.color ?? DARK_TEXT,
  };
}

/** Una imagen nueva (de las subidas): ancho 40 % y alto proporcional al formato (cuadrada), «Contener» para no recortarla. */
export function newImageElement(format: FormatKey, asset: string, at?: { x: number; y: number }): ImageElement {
  const def = FORMATS[format];
  const h = Math.min(100, (40 * def.width) / pageHeightFor(format));
  return { id: newId("el"), type: "image", x: at?.x ?? 50, y: at?.y ?? 50, w: 40, h: Math.round(h * 100) / 100, asset, fit: "contain" };
}

export type ShapeKind = ShapeElement["shape"];

export const SHAPE_LABELS: Record<ShapeKind, string> = { rect: "Rectángulo", circle: "Círculo", line: "Línea" };

/** Una forma nueva: rectángulo y círculo con relleno de acento, una línea fina. */
export function newShapeElement(format: FormatKey, shape: ShapeKind, accent = "#4f46e5", at?: { x: number; y: number }): ShapeElement {
  const def = FORMATS[format];
  const side = shape === "line" ? 0 : Math.round(((30 * def.width) / pageHeightFor(format)) * 100) / 100;
  const base = { id: newId("el"), type: "shape" as const, x: at?.x ?? 50, y: at?.y ?? 50, shape };
  if (shape === "line") return { ...base, w: 40, stroke: { color: accent, width: 4 } };
  return { ...base, w: 30, h: Math.min(100, side), fill: accent, radius: shape === "rect" ? 0 : undefined };
}

/** El alto de diseño de una página nueva del formato (en `web`, el inicial). */
export function pageHeightFor(format: FormatKey): number {
  return FORMATS[format].height;
}

export interface StarterOptions {
  /** El color de la marca del negocio (#rrggbb). Sin él, la página es blanca. */
  brandColor?: string | null;
  /** «Varias páginas»: arranca con dos (se suman con el «+»). Una página web siempre tiene una. */
  multiPage?: boolean;
  /** La clave del estilo elegido. */
  style?: string | null;
}

function backgroundColor(opts: StarterOptions): string {
  return opts.brandColor && isColor(opts.brandColor) ? opts.brandColor.toLowerCase() : DEFAULT_PAGE_BACKGROUND;
}

function colorPage(format: FormatKey, color: string): DesignPage {
  const page: DesignPage = { id: newId("pg"), background: { type: "color", color }, elements: [] };
  if (format === "web") page.height = FORMATS.web.height;
  return page;
}

function pageCountFor(format: FormatKey, multi: boolean | undefined): number {
  return FORMATS[format].multiPage && multi ? 2 : 1;
}

function withStyle(doc: DesignDoc, style: string | null | undefined): DesignDoc {
  return style ? { ...doc, style } : doc;
}

/** En blanco: el fondo con el color de la marca y un texto «Escribí acá» (F30). */
export function blankDoc(format: FormatKey, opts: StarterOptions = {}): DesignDoc {
  const color = backgroundColor(opts);
  const pages = Array.from({ length: pageCountFor(format, opts.multiPage) }, () => colorPage(format, color));
  pages[0].elements.push(
    newTextElement(format, "title", {
      text: PLACEHOLDER_TEXT,
      color: readableTextColor(color),
      at: format === "web" ? { x: 50, y: 8 } : { x: 50, y: 40 },
    }),
  );
  return withStyle({ v: 1, format, pages }, opts.style);
}

/**
 * Desde una imagen: la imagen subida es el fondo BLOQUEADO de la página 1, con ajuste «Cubrir» y el punto focal al
 * centro (F30). Las demás páginas, si las hay, son de color.
 */
export function imageDoc(format: FormatKey, assetPath: string, opts: StarterOptions = {}): DesignDoc {
  const color = backgroundColor(opts);
  const pages = Array.from({ length: pageCountFor(format, opts.multiPage) }, () => colorPage(format, color));
  pages[0] = { ...pages[0], background: { type: "image", color, image: { asset: assetPath, fit: "cover", focal: { x: 50, y: 50 }, locked: true } } };
  return withStyle({ v: 1, format, pages }, opts.style);
}

/** Con IA: una página sin elementos con el color de la marca; la IA arma el resto (DS3). */
export function aiStartDoc(format: FormatKey, opts: StarterOptions = {}): DesignDoc {
  return withStyle({ v: 1, format, pages: [colorPage(format, backgroundColor(opts))] }, opts.style);
}

/** El nombre con el que nace un diseño o una plantilla si la persona no escribió uno. */
export function defaultName(kind: "design" | "template"): string {
  return kind === "template" ? "Plantilla nueva" : "Diseño nuevo";
}
