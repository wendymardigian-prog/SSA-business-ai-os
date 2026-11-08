/**
 * Formatos de Contenido ↔ formatos del Diseñador IA (DS8, F61).
 *
 * Qué diseño sirve para qué publicación de una red, y cómo se convierte en archivos de la pieza: un PNG por página
 * o, en el carrusel PDF de LinkedIn, un solo PDF con todas las páginas. Es la ÚNICA tabla que lo dice: el modal «Usar en
 * contenido», «Diseñar con el Diseñador IA» desde una pieza y el job que sincroniza leen de acá. Los formatos de
 * Contenido (`lib/content/network-format.ts`) siguen siendo los suyos y no se tocan; un test compara las dos listas.
 *
 * Formatos que no van a redes (A4, carta horizontal, página web) no ofrecen «Usar en contenido». Carta vertical y
 * presentación 16:9 solo sirven para el PDF de LinkedIn (un documento es un documento): son los dos formatos no
 * sociales que el botón del editor ya deja pasar (`CONTENT_FORMATS`).
 *
 * Módulo puro: lo usan el servidor, el modal y los tests.
 */

import { FORMATS, MAX_PAGES, type FormatKey } from "./formats";
import { platformLabel } from "@/lib/platforms";

/** Qué archivos produce la sincronización de una publicación. */
export type ContentOutput = "png" | "pdf";

export interface ContentTarget {
  /** La red (`instagram`, `tiktok`, `linkedin`, `threads`). */
  platform: string;
  /** El formato de ESA red en Contenido (`carousel`, `image`, `story`, `photos`, `pdf`…). */
  format: string;
  /** «Instagram · Carrusel». */
  label: string;
  /** Los formatos de diseño que sirven para esta publicación. */
  designFormats: readonly FormatKey[];
  /** El que se elige al diseñar desde la pieza. */
  defaultFormat: FormatKey;
  /** Si el diseño que se crea para esta publicación arranca con varias páginas. */
  multiPage: boolean;
  output: ContentOutput;
  /** Cuántos archivos admite la publicación en Contenido (para avisar; lo que valida es Contenido). */
  files: { min: number; max: number };
  /** Un aviso fijo de la red, si hace falta (TikTok). */
  note?: string;
}

const SOCIAL: readonly FormatKey[] = ["v45", "sq"];

/** Las publicaciones que se pueden armar con un diseño. */
export const CONTENT_TARGETS: readonly ContentTarget[] = [
  { platform: "instagram", format: "carousel", label: "Instagram · Carrusel", designFormats: SOCIAL, defaultFormat: "v45", multiPage: true, output: "png", files: { min: 2, max: 10 } },
  { platform: "instagram", format: "image", label: "Instagram · Imagen", designFormats: SOCIAL, defaultFormat: "v45", multiPage: false, output: "png", files: { min: 1, max: 1 } },
  { platform: "instagram", format: "story", label: "Instagram · Historia", designFormats: ["story"], defaultFormat: "story", multiPage: true, output: "png", files: { min: 1, max: 1 } },
  {
    platform: "tiktok",
    format: "photos",
    label: "TikTok · Carrusel de fotos",
    designFormats: ["story", "v45"],
    defaultFormat: "story",
    multiPage: true,
    output: "png",
    files: { min: 2, max: 35 },
    note: `TikTok admite hasta 35 fotos por carrusel; un diseño llega hasta ${MAX_PAGES} páginas.`,
  },
  { platform: "linkedin", format: "image", label: "LinkedIn · Imagen", designFormats: ["sq", "v45"], defaultFormat: "sq", multiPage: false, output: "png", files: { min: 1, max: 1 } },
  { platform: "linkedin", format: "pdf", label: "LinkedIn · Carrusel PDF", designFormats: ["sq", "v45", "carta_v", "wide"], defaultFormat: "v45", multiPage: true, output: "pdf", files: { min: 1, max: 1 } },
  { platform: "threads", format: "image", label: "Threads · Imagen", designFormats: SOCIAL, defaultFormat: "v45", multiPage: false, output: "png", files: { min: 1, max: 1 } },
  { platform: "threads", format: "carousel", label: "Threads · Carrusel", designFormats: SOCIAL, defaultFormat: "v45", multiPage: true, output: "png", files: { min: 2, max: 10 } },
];

/** La publicación que corresponde a una red y un formato de Contenido; null si no se hace con un diseño (un Reel, un video, solo texto). */
export function contentTarget(platform: string, format: string | null | undefined): ContentTarget | null {
  if (!format) return null;
  return CONTENT_TARGETS.find((t) => t.platform === platform && t.format === format) ?? null;
}

/** Los formatos de Contenido de una red que se arman con un diseño, en el orden de la tabla. */
export function targetsForPlatform(platform: string): ContentTarget[] {
  return CONTENT_TARGETS.filter((t) => t.platform === platform);
}

/** Las publicaciones donde sirve un diseño de este formato (vacío = el botón «Usar en contenido» no se ofrece). */
export function targetsForDesignFormat(format: FormatKey): ContentTarget[] {
  return CONTENT_TARGETS.filter((t) => t.designFormats.includes(format));
}

/** Si un diseño de este formato se puede usar en Contenido. */
export function canUseInContent(format: FormatKey): boolean {
  return targetsForDesignFormat(format).length > 0;
}

/**
 * El diseño que se crea para una publicación (F62): su formato y si arranca con varias páginas. `preferred` es el
 * formato que ya tiene la pieza en mente; si no sirve para esa publicación, se usa el de siempre.
 */
export function designFormatFor(target: ContentTarget, preferred?: FormatKey | null): { format: FormatKey; multiPage: boolean } {
  const format = preferred && target.designFormats.includes(preferred) ? preferred : target.defaultFormat;
  return { format, multiPage: target.multiPage };
}

/** Lo que se convierte en archivos: un PNG por página, o un solo PDF con todas. */
export type ContentFilePlan = { output: "png"; count: number } | { output: "pdf"; count: 1 };

/** La conversión del diseño en archivos de la pieza. Un diseño siempre tiene al menos una página. */
export function filePlan(target: ContentTarget, pageCount: number): ContentFilePlan {
  const pages = Math.max(1, Math.floor(pageCount));
  return target.output === "pdf" ? { output: "pdf", count: 1 } : { output: "png", count: pages };
}

export interface PageFit {
  /** `warn` no impide nada: Contenido igual avisa al programar (un carrusel con una sola página no se programa). */
  level: "ok" | "warn";
  message: string | null;
}

/** Si la cantidad de páginas del diseño cuadra con lo que pide la publicación. */
export function pageFit(target: ContentTarget, pageCount: number): PageFit {
  const plan = filePlan(target, pageCount);
  const { min, max } = target.files;
  if (plan.count > max) {
    const what = target.format === "story" ? "Cada página del diseño es una historia, pero Contenido publica una por vez" : `${platformLabel(target.platform)} admite hasta ${max} ${max === 1 ? "imagen" : "imágenes"} en ${article(target)}`;
    return { level: "warn", message: `${what}: el diseño tiene ${plan.count} páginas y habrá que dejar ${max === 1 ? "una" : `hasta ${max}`} en la red.` };
  }
  if (plan.count < min) {
    return { level: "warn", message: `${target.label} necesita al menos ${min} imágenes y el diseño tiene ${plan.count === 1 ? "1 página" : `${plan.count} páginas`}. Se puede armar, pero no se programa hasta sumar más.` };
  }
  return { level: "ok", message: null };
}

function article(target: ContentTarget): string {
  return target.format === "carousel" ? "un carrusel" : target.format === "photos" ? "un carrusel de fotos" : "una publicación";
}

/** Los pixeles de cada archivo: el tamaño del diseño, sin ampliar (PNG ×1 al tamaño de la red). */
export function outputSize(format: FormatKey): { width: number; height: number } {
  const { width, height } = FORMATS[format];
  return { width, height };
}
