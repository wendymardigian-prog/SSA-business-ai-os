/**
 * Colores del Diseñador IA (F12): contraste WCAG y la capa de color sobre una foto.
 *
 * Trabaja con "#rrggbb" y "#rrggbbaa" (el alfa se ignora para el contraste: lo
 * que importa es el color que se ve). Lo usan el selector de colores, la IA
 * (para calcular la capa que alcanza el contraste mínimo, F33) y la revisión
 * automática (F36), que recibe la luminancia medida del fondo detrás de cada
 * texto desde el servicio de render.
 *
 * Módulo puro.
 */

import { COLOR_RE } from "./doc/schema";

export function isColor(value: unknown): value is string {
  return typeof value === "string" && COLOR_RE.test(value);
}

/** Los tres canales 0–255 de un color (el alfa, si viene, se descarta). */
export function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** La luminancia relativa de WCAG (0 = negro, 1 = blanco). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** El contraste entre dos luminancias (de 1 a 21). */
export function contrastFromLuminance(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** El contraste WCAG entre dos colores (de 1 a 21). 4,5 es lo mínimo para texto de cuerpo; 3 para títulos grandes. */
export function contrastRatio(a: string, b: string): number {
  return contrastFromLuminance(relativeLuminance(a), relativeLuminance(b));
}

/**
 * La luminancia que queda cuando se pone una capa de color con `opacity` sobre
 * un fondo de luminancia `bgLuminance`. Es una aproximación (mezcla lineal de
 * luminancias), suficiente para decidir si un texto se lee.
 */
export function mixOverlay(bgLuminance: number, overlayColor: string, opacity: number): number {
  const a = clamp(opacity, 0, 1);
  const bg = clamp(bgLuminance, 0, 1);
  return bg * (1 - a) + relativeLuminance(overlayColor) * a;
}

/** El contraste mínimo que pide la regla de diseño: 4,5 para cuerpo y 3 para títulos grandes. */
export function minContrastFor(fontSizePx: number, minFontSizePx: number): number {
  return fontSizePx >= Math.max(48, minFontSizePx * 1.6) ? 3 : 4.5;
}

/**
 * La opacidad más baja (de a 5 %, hasta 90 %) de una capa de `overlayColor` que
 * hace que `textColor` alcance `minRatio` sobre un fondo de `bgLuminance`.
 * `null` si ni con 90 % alcanza (entonces conviene cambiar el color del texto).
 */
export function overlayForContrast(textColor: string, bgLuminance: number, overlayColor: string, minRatio: number): number | null {
  const text = relativeLuminance(textColor);
  for (let step = 0; step <= 18; step++) {
    const opacity = step * 0.05;
    if (contrastFromLuminance(text, mixOverlay(bgLuminance, overlayColor, opacity)) >= minRatio) return Math.round(opacity * 100) / 100;
  }
  return null;
}

/** Un color libre escrito a mano: con o sin "#", 3 o 6 dígitos. Devuelve "#rrggbb" o null. */
export function normalizeHexInput(raw: string): string | null {
  const value = raw.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(value)) return `#${value.split("").map((c) => c + c).join("")}`;
  if (/^[0-9a-f]{6}$/.test(value)) return `#${value}`;
  return null;
}

/** "#rrggbb" + opacidad 0–1 → "rgba(r, g, b, a)" para CSS. */
export function rgba(hex: string, opacity: number): string {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(clamp(opacity, 0, 1) * 1000) / 1000})`;
}

/**
 * Los colores que ofrece el selector (F12), sin repetir: primero los de la
 * marca, después la paleta propia del negocio y al final los usados en el diseño.
 */
export function colorChoices(input: { brandColor?: string | null; palette?: readonly string[]; used?: readonly string[] }): {
  brand: string[];
  used: string[];
} {
  const seen = new Set<string>();
  const take = (list: readonly (string | null | undefined)[]) =>
    list
      .filter(isColor)
      .map((c) => c.toLowerCase())
      .filter((c) => (seen.has(c) ? false : (seen.add(c), true)));
  const brand = take([input.brandColor ?? null, ...(input.palette ?? [])]);
  const used = take(input.used ?? []);
  return { brand, used };
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
