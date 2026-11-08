/**
 * La barra del elemento (F21): qué controles tiene cada tipo de elemento y qué cambia cada uno.
 *
 * Con algo seleccionado, la barra del lienzo cambia a las acciones del elemento: nombre, orden y, según el tipo:
 *   - **Texto:** tipografía, peso, tamaño (A− / campo / A+), cursiva, mayúsculas, interlineado, espaciado, alineación,
 *     color, resaltado de fondo, sombra y «{ } Insertar variable» (solo en plantillas).
 *   - **Imagen:** reemplazar, ajuste (cubrir / contener), esquinas redondeadas y opacidad.
 *   - **Forma:** relleno, borde, esquinas y opacidad (una línea: solo borde y opacidad).
 *   - **Todos:** alinear a la página (6 botones), duplicar, bloquear, eliminar y «Listo».
 * En pantallas angostas la barra es una hoja inferior con pestañas: Texto (o Imagen, o Forma) · Orden · Más.
 *
 * `toolbarFor` dice QUÉ se muestra; las funciones `set…` devuelven el parche de cada control (con los límites del
 * documento) y la barra solo las llama.
 *
 * Módulo puro.
 */

import { clamp, isColor } from "../color";
import type { DesignElement, ImageElement, ShapeElement, TextElement } from "../doc/schema";
import { curatedFont, nearestWeight } from "../fonts";
import type { ElementPatch } from "./doc-ops";

export type ControlId =
  | "name"
  | "order"
  | "font"
  | "weight"
  | "size"
  | "italic"
  | "uppercase"
  | "lineHeight"
  | "letterSpacing"
  | "align"
  | "color"
  | "highlight"
  | "shadow"
  | "variable"
  | "replace"
  | "fit"
  | "radius"
  | "opacity"
  | "fill"
  | "stroke"
  | "alignPage"
  | "duplicate"
  | "lock"
  | "delete"
  | "done";

export type GroupId = "name" | "order" | "style" | "alignPage" | "actions";

export interface ToolGroup {
  id: GroupId;
  label: string;
  controls: ControlId[];
}

const STYLE_CONTROLS: Record<DesignElement["type"], ControlId[]> = {
  text: ["font", "weight", "size", "italic", "uppercase", "lineHeight", "letterSpacing", "align", "color", "highlight", "shadow"],
  image: ["replace", "fit", "radius", "opacity"],
  shape: ["fill", "stroke", "radius", "opacity"],
  html: ["opacity"],
};

/** Los grupos de la barra para un elemento. Un grupo sin controles no se devuelve. */
export function toolbarFor(el: Pick<DesignElement, "type"> & { shape?: string }, isTemplate: boolean): ToolGroup[] {
  let style = [...STYLE_CONTROLS[el.type]];
  if (el.type === "text" && isTemplate) style = [...style, "variable"];
  // Una línea no tiene relleno ni esquinas: solo su borde y la opacidad.
  if (el.type === "shape" && el.shape === "line") style = ["stroke", "opacity"];
  return [
    { id: "name", label: "Nombre", controls: ["name"] },
    { id: "order", label: "Orden", controls: ["order"] },
    { id: "style", label: STYLE_LABELS[el.type], controls: style },
    { id: "alignPage", label: "Alinear a la página", controls: ["alignPage"] },
    { id: "actions", label: "Acciones", controls: ["duplicate", "lock", "delete", "done"] },
  ].filter((group) => group.controls.length > 0) as ToolGroup[];
}

const STYLE_LABELS: Record<DesignElement["type"], string> = { text: "Texto", image: "Imagen", shape: "Forma", html: "Bloque" };

export interface SheetTab {
  id: "style" | "order" | "more";
  label: string;
  groups: GroupId[];
}

/** Las pestañas de la hoja inferior del celular: Texto (o Imagen, o Forma) · Orden · Más. */
export function sheetTabsFor(el: Pick<DesignElement, "type">): SheetTab[] {
  return [
    { id: "style", label: STYLE_LABELS[el.type], groups: ["style"] },
    { id: "order", label: "Orden", groups: ["name", "order", "alignPage"] },
    { id: "more", label: "Más", groups: ["actions"] },
  ];
}

/** Si un control está en la barra de ese elemento (para que el parche no se aplique a un tipo que no lo tiene). */
export function hasControl(el: Pick<DesignElement, "type"> & { shape?: string }, isTemplate: boolean, control: ControlId): boolean {
  return toolbarFor(el, isTemplate).some((group) => group.controls.includes(control));
}

// ─── Qué cambia cada control ─────────────────────────────────────────────────

export const MIN_FONT_SIZE = 4;
export const MAX_FONT_SIZE = 1000;

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Otra tipografía. Si la familia curada no tiene el peso actual, queda el más cercano que sí tiene. */
export function setFontFamily(el: TextElement, family: string): ElementPatch {
  const curated = curatedFont(family);
  const weight = curated ? nearestWeight(curated.weights, el.font.weight) : el.font.weight;
  return { font: { ...el.font, family, weight } };
}

export function setWeight(el: TextElement, weight: number): ElementPatch {
  return { font: { ...el.font, weight: clamp(Math.round(weight / 100) * 100, 100, 900) } };
}

export function toggleItalic(el: TextElement): ElementPatch {
  const font: TextElement["font"] = { ...el.font };
  if (el.font.italic) delete font.italic;
  else font.italic = true;
  return { font };
}

export function toggleUppercase(el: TextElement): ElementPatch {
  return { transform: el.transform === "uppercase" ? undefined : "uppercase" };
}

/** El tamaño de letra, entero y dentro de los límites del documento (4–1000 px). */
export function setSize(_el: TextElement, size: number): ElementPatch {
  return { size: Math.round(clamp(size, MIN_FONT_SIZE, MAX_FONT_SIZE)) };
}

/** A+ / A−: un 10 % más o menos, y siempre al menos 1 px de diferencia. */
export function stepSize(el: TextElement, direction: 1 | -1): ElementPatch {
  const scaled = Math.round(el.size * (direction === 1 ? 1.1 : 0.9));
  const next = direction === 1 ? Math.max(scaled, el.size + 1) : Math.min(scaled, el.size - 1);
  return setSize(el, next);
}

export function setLineHeight(_el: TextElement, value: number): ElementPatch {
  return { lineHeight: round(clamp(value, 0.5, 4)) };
}

export function setLetterSpacing(_el: TextElement, value: number): ElementPatch {
  return { letterSpacing: round(clamp(value, -50, 200)) };
}

export function setAlign(_el: TextElement, align: TextElement["align"]): ElementPatch {
  return { align };
}

/** El color, solo si es válido (#rrggbb). */
export function setColor(el: TextElement, color: string): ElementPatch {
  return isColor(color) ? { color: color.toLowerCase() } : {};
}

/** El resaltado de fondo (color + opacidad); `null` lo quita. */
export function setHighlight(_el: TextElement, highlight: { color: string; opacity: number } | null): ElementPatch {
  if (!highlight) return { highlight: undefined };
  if (!isColor(highlight.color)) return {};
  return { highlight: { color: highlight.color.toLowerCase(), opacity: round(clamp(highlight.opacity, 0, 1)) } };
}

export function toggleShadow(el: TextElement): ElementPatch {
  return { shadow: el.shadow ? undefined : true };
}

export function setImageFit(_el: ImageElement, fit: ImageElement["fit"]): ElementPatch {
  return { fit };
}

export function setRadius(_el: ImageElement | ShapeElement, radius: number): ElementPatch {
  return { radius: Math.round(clamp(radius, 0, 2000)) };
}

export function setOpacity(_el: DesignElement, opacity: number): ElementPatch {
  const value = round(clamp(opacity, 0, 1));
  return { opacity: value >= 1 ? undefined : value };
}

export function replaceImage(_el: ImageElement, asset: string): ElementPatch {
  return { asset };
}

export function setFill(_el: ShapeElement, fill: string | null): ElementPatch {
  if (fill === null) return { fill: undefined };
  return isColor(fill) ? { fill: fill.toLowerCase() } : {};
}

/** El borde (color + grosor); `null` lo quita. El grosor va de 0 a 200 px. */
export function setStroke(_el: ShapeElement, stroke: { color: string; width: number } | null): ElementPatch {
  if (!stroke) return { stroke: undefined };
  if (!isColor(stroke.color)) return {};
  return { stroke: { color: stroke.color.toLowerCase(), width: round(clamp(stroke.width, 0, 200)) } };
}
