/**
 * Las reglas de diseño FIJAS de la IA (F32).
 *
 * Viajan siempre en el prompt del sistema y no las edita el usuario: salen de
 * este archivo y de `FORMATS` (tamaño mínimo de letra, zonas seguras), y la
 * revisión automática (F36) mide exactamente las mismas cifras. Una sola
 * fuente: si cambia una regla, cambia en el prompt y en la revisión a la vez.
 *
 * Módulo puro.
 */

import { FORMATS, isPrintFormat, type FormatKey } from "../formats";

/** Contraste mínimo de WCAG para texto de cuerpo. */
export const MIN_CONTRAST_BODY = 4.5;
/** Contraste mínimo para títulos grandes. */
export const MIN_CONTRAST_TITLE = 3;

/** Los formatos de redes donde la primera imagen adjunta va de fondo de la portada (F33). */
export const COVER_IMAGE_FORMATS: readonly FormatKey[] = ["sq", "v45", "story"];

/** Los formatos donde el diseño es un carrusel o una serie: portada gancho y cierre con llamado a la acción. */
export function isSeriesFormat(format: FormatKey): boolean {
  return FORMATS[format].group === "redes" || FORMATS[format].group === "presentacion";
}

/** Los límites de la zona segura de un formato, en porcentaje de la página (0–100). */
export interface SafeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function safeBounds(format: FormatKey): SafeBounds {
  const z = FORMATS[format].safeZone;
  return { minX: z.left, maxX: 100 - z.right, minY: z.top, maxY: 100 - z.bottom };
}

/** La zona segura escrita en palabras y px, para el prompt. */
export function safeZoneText(format: FormatKey): string {
  const def = FORMATS[format];
  const z = def.safeZone;
  const px = (pct: number, total: number) => Math.round((pct / 100) * total);
  const b = safeBounds(format);
  const parts = [
    `margen izquierdo ${z.left} % (${px(z.left, def.width)} px)`,
    `derecho ${z.right} % (${px(z.right, def.width)} px)`,
    `superior ${z.top} % (${px(z.top, def.height)} px)`,
    `inferior ${z.bottom} % (${px(z.bottom, def.height)} px)`,
  ];
  return `Zona segura de ${def.label}: ${parts.join(", ")}. Todo texto tiene que quedar con su centro y sus bordes entre x ${b.minX}–${b.maxX} % e y ${b.minY}–${b.maxY} %.`;
}

/**
 * Las reglas de diseño del prompt, una por línea. `maxWords` es la densidad del
 * estilo para el formato (palabras por página).
 */
export function designRules(format: FormatKey, maxWords: number): string[] {
  const def = FORMATS[format];
  const rules = [
    "Jerarquía clara: un título dominante por página, mucho más grande que el resto.",
    "Una sola idea por página.",
    `Máximo ${maxWords} palabras por página (sumando todos los textos).`,
    `Tamaño mínimo de letra: ${def.minFontSize} px en este formato (tamaño real en px de diseño, ${def.width} × ${def.height}).`,
    safeZoneText(format),
    `Contraste mínimo medido: ${MIN_CONTRAST_BODY}:1 para texto de cuerpo y ${MIN_CONTRAST_TITLE}:1 para títulos grandes. Sobre una foto, poné una capa de color (overlay) que lo asegure.`,
    "Nada de texto sobre caras en las fotos: usá el punto focal (focal) para que la cara quede fuera del texto.",
    "Usá SOLO las fuentes de la lista permitida. Ninguna otra.",
    "No generes imágenes: usá solo las imágenes adjuntas (por su nombre, imagen_1, imagen_2…), colores, degradés y formas.",
    "Posiciones y tamaños en porcentaje de la página. x e y son el CENTRO del elemento; w es el ancho. Los textos no llevan alto (h).",
  ];
  if (isSeriesFormat(format)) {
    rules.push("En una serie de páginas, la portada es un gancho (una promesa o pregunta corta) y la última página es un llamado a la acción.");
    rules.push("Una numeración chica «N/M» en una esquina es opcional: usala solo si el estilo la pide.");
  }
  if (isPrintFormat(format)) {
    rules.push("Es un documento impreso: composición sobria, márgenes generosos y bordes limpios.");
  }
  if (format === "web") {
    rules.push("Es una página web de una sola página de 1280 px de ancho: apilá secciones de arriba hacia abajo y poné el alto total en height (en px).");
  }
  return rules;
}
