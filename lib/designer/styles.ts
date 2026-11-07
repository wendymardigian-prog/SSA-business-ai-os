/**
 * Los estilos del Diseñador IA (F13).
 *
 * Un estilo es una DIRECCIÓN, no un molde: una paleta por rol, una pareja de
 * fuentes, una densidad (máximo de palabras por página según el formato) y
 * reglas de composición en texto para la IA. La IA compone libremente dentro
 * de él. Los estilos propios del negocio (F37, `design_settings.styles`) tienen
 * exactamente la misma forma (`styleSchema`).
 *
 * Módulo puro.
 */

import { z } from "zod";
import { COLOR_RE } from "./doc/schema";
import { FORMAT_KEYS, type FormatKey } from "./formats";
import { FONT_FAMILY_RE } from "./fonts";

const color = z.string().regex(COLOR_RE, { message: "no es un color válido (#rrggbb)" });

export const STYLE_KEY_RE = /^(?:[a-z]{3,12}|c_[a-z0-9]{3,12})$/;

export const styleSchema = z.object({
  key: z.string().regex(STYLE_KEY_RE, { message: "la clave del estilo no es válida" }),
  name: z.string().trim().min(1, { message: "el estilo necesita un nombre" }).max(60),
  description: z.string().max(200).optional(),
  palette: z.object({ bg: color, text: color, accent: color }),
  fonts: z.object({
    title: z.string().regex(FONT_FAMILY_RE, { message: "la fuente de títulos no es válida" }),
    body: z.string().regex(FONT_FAMILY_RE, { message: "la fuente de cuerpo no es válida" }),
  }),
  density: z.partialRecord(z.enum(FORMAT_KEYS), z.number().int().min(5).max(1000)),
  rules: z.string().max(4000),
  archived: z.boolean().optional(),
});

export type DesignStyle = z.infer<typeof styleSchema>;

/** Densidad por defecto: máximo de palabras por página según el formato. */
const DENSITY = (social: number, story: number, slides: number, print: number, web: number): DesignStyle["density"] => ({
  sq: social,
  v45: social,
  story,
  wide: slides,
  carta_v: print,
  carta_h: print,
  a4_v: print,
  a4_h: print,
  web,
});

/** Los seis estilos de fábrica. "Automático" deja que la IA elija según el contenido. */
export const FACTORY_STYLES: readonly DesignStyle[] = [
  {
    key: "auto",
    name: "Automático",
    description: "La IA elige la dirección según lo que pedís.",
    palette: { bg: "#ffffff", text: "#111111", accent: "#4f46e5" },
    fonts: { title: "Inter", body: "Inter" },
    density: DENSITY(30, 22, 40, 120, 400),
    rules: "Elegí la dirección visual según el contenido y la marca: si es para redes, más dinámica; si es institucional, más sobria. Usá los colores de la marca si los hay.",
  },
  {
    key: "social",
    name: "Dinámico de redes",
    description: "Títulos grandes, contraste alto, ritmo de carrusel.",
    palette: { bg: "#0f1115", text: "#ffffff", accent: "#c4d94a" },
    fonts: { title: "Archivo Black", body: "Inter" },
    density: DENSITY(25, 18, 30, 90, 300),
    rules: "Títulos muy grandes y cortos, alto contraste, un acento de color por página. La portada es un gancho y la última página un llamado a la acción. Numeración N/M chica en una esquina.",
  },
  {
    key: "editorial",
    name: "Editorial serio",
    description: "Serif elegante, mucho aire, jerarquía clásica.",
    palette: { bg: "#f7f5f0", text: "#1d1d1b", accent: "#8b5e34" },
    fonts: { title: "Playfair Display", body: "Lora" },
    density: DENSITY(35, 25, 45, 160, 500),
    rules: "Composición sobria con mucho espacio en blanco, títulos en serif y cuerpo legible. Filetes finos y alineación a la izquierda. Sin efectos.",
  },
  {
    key: "minimal",
    name: "Minimal",
    description: "Pocas cosas, mucho espacio, una sola idea fuerte.",
    palette: { bg: "#ffffff", text: "#111111", accent: "#111111" },
    fonts: { title: "Space Grotesk", body: "DM Sans" },
    density: DENSITY(18, 12, 25, 80, 250),
    rules: "Muy pocas palabras por página, una sola idea, mucho espacio vacío. Tipografía protagonista, sin adornos ni fondos cargados.",
  },
  {
    key: "impact",
    name: "Impacto",
    description: "Letras enormes, colores fuertes, mayúsculas.",
    palette: { bg: "#ff3b30", text: "#ffffff", accent: "#111111" },
    fonts: { title: "Anton", body: "Montserrat" },
    density: DENSITY(15, 12, 20, 70, 220),
    rules: "Títulos gigantes en mayúsculas que ocupan casi todo el ancho, colores saturados y contraste máximo. Frases cortas y directas.",
  },
  {
    key: "warm",
    name: "Cálido y personal",
    description: "Tonos suaves, toques manuscritos, cercano.",
    palette: { bg: "#fdf3e7", text: "#3b2f2f", accent: "#e07a5f" },
    fonts: { title: "Fraunces", body: "Nunito" },
    density: DENSITY(30, 22, 40, 130, 400),
    rules: "Tonos cálidos, esquinas redondeadas, un detalle manuscrito como acento. Tono cercano, en primera persona, y fotos de personas cuando las haya.",
  },
];

export const DEFAULT_STYLE_KEY = "auto";

/** Un estilo por clave: los de fábrica y los propios (no archivados). */
export function findStyle(key: string | null | undefined, custom: readonly DesignStyle[] = []): DesignStyle | undefined {
  if (!key) return undefined;
  return FACTORY_STYLES.find((s) => s.key === key) ?? custom.find((s) => s.key === key && !s.archived);
}

/** Los estilos que se ofrecen: los de fábrica y después los propios no archivados. */
export function availableStyles(custom: readonly DesignStyle[] = []): DesignStyle[] {
  return [...FACTORY_STYLES, ...custom.filter((s) => !s.archived)];
}

/** El máximo de palabras por página de un estilo en un formato (con un valor por defecto). */
export function wordsPerPage(style: DesignStyle | undefined, format: FormatKey): number {
  return style?.density[format] ?? FACTORY_STYLES[0].density[format] ?? 40;
}
