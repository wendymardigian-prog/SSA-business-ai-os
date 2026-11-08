/**
 * Los formatos del Diseñador IA (F9).
 *
 * Un formato es el tamaño de diseño de una pieza en px, para qué sirve, si
 * admite varias páginas, qué se exporta y sus zonas seguras. Todo lo demás del
 * módulo (el documento, el render, los imanes, la IA y Contenido) lee de acá:
 * no hay otro lugar que sepa cuánto mide una historia.
 *
 * Las zonas seguras se guardan en porcentaje de la página, como las posiciones
 * del documento, así sirven igual a cualquier escala.
 *
 * Módulo puro: lo usan el servidor, el lienzo y los tests.
 */

export const FORMAT_KEYS = ["carta_v", "carta_h", "a4_v", "a4_h", "sq", "v45", "story", "wide", "web"] as const;
export type FormatKey = (typeof FORMAT_KEYS)[number];

/** Los formatos impresos: los únicos donde existe la verificación (V2). */
export const PRINT_FORMATS = ["carta_v", "carta_h", "a4_v", "a4_h"] as const satisfies readonly FormatKey[];

/** Qué produce una exportación del formato. `none` = solo se comparte con link (página web). */
export type ExportKind = "pdf" | "png" | "none";

/** Márgenes de seguridad en porcentaje de la página (arriba, derecha, abajo, izquierda). */
export interface SafeZone {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FormatDef {
  key: FormatKey;
  /** Ancho de diseño en px. */
  width: number;
  /** Alto de diseño en px. En `web` es el alto inicial: la página lo cambia. */
  height: number;
  label: string;
  /** Para qué sirve, en una línea (se ve en el paso "Formato" de Nuevo). */
  description: string;
  multiPage: boolean;
  /** Lo principal que exporta: PDF en impresos y presentaciones, PNG en redes. */
  primaryExport: ExportKind;
  /** Escala de exportación: impresos ×1, redes y presentaciones ×2 (F46). */
  exportScale: 1 | 2;
  safeZone: SafeZone;
  /** Tamaño mínimo de letra en px de diseño (regla de la IA y de la revisión, F32 y F36). */
  minFontSize: number;
  /** Grupo para el desplegable de formato. */
  group: "impreso" | "redes" | "presentacion" | "web";
}

const pct = (px: number, total: number) => Math.round((px / total) * 10_000) / 100;

const SIX = { top: 6, right: 6, bottom: 6, left: 6 } satisfies SafeZone;

export const FORMATS: Record<FormatKey, FormatDef> = {
  carta_v: {
    key: "carta_v",
    width: 816,
    height: 1056,
    label: "Documento carta",
    description: "Vertical · PDF",
    multiPage: true,
    primaryExport: "pdf",
    exportScale: 1,
    safeZone: SIX,
    minFontSize: 18,
    group: "impreso",
  },
  carta_h: {
    key: "carta_h",
    width: 1056,
    height: 816,
    label: "Carta horizontal",
    description: "Certificados · PDF",
    multiPage: true,
    primaryExport: "pdf",
    exportScale: 1,
    safeZone: SIX,
    minFontSize: 18,
    group: "impreso",
  },
  a4_v: {
    key: "a4_v",
    width: 794,
    height: 1123,
    label: "Documento A4",
    description: "Vertical · PDF",
    multiPage: true,
    primaryExport: "pdf",
    exportScale: 1,
    safeZone: SIX,
    minFontSize: 18,
    group: "impreso",
  },
  a4_h: {
    key: "a4_h",
    width: 1123,
    height: 794,
    label: "A4 horizontal",
    description: "Certificados · PDF",
    multiPage: true,
    primaryExport: "pdf",
    exportScale: 1,
    safeZone: SIX,
    minFontSize: 18,
    group: "impreso",
  },
  sq: {
    key: "sq",
    width: 1080,
    height: 1080,
    label: "Cuadrado 1:1",
    description: "Post · imagen",
    multiPage: true,
    primaryExport: "png",
    exportScale: 2,
    safeZone: SIX,
    minFontSize: 34,
    group: "redes",
  },
  v45: {
    key: "v45",
    width: 1080,
    height: 1350,
    label: "Vertical 4:5",
    description: "Post y carrusel · imagen",
    multiPage: true,
    primaryExport: "png",
    exportScale: 2,
    safeZone: SIX,
    minFontSize: 34,
    group: "redes",
  },
  story: {
    key: "story",
    width: 1080,
    height: 1920,
    label: "Historia 9:16",
    description: "Historias y reels · imagen",
    multiPage: true,
    primaryExport: "png",
    exportScale: 2,
    // Instagram tapa arriba (250 px) con la barra y abajo (340 px) con la respuesta.
    safeZone: { top: pct(250, 1920), right: 6, bottom: pct(340, 1920), left: 6 },
    minFontSize: 40,
    group: "redes",
  },
  wide: {
    key: "wide",
    width: 1920,
    height: 1080,
    label: "Presentación 16:9",
    description: "Slides · PDF o imágenes",
    multiPage: true,
    primaryExport: "pdf",
    exportScale: 2,
    safeZone: SIX,
    minFontSize: 28,
    group: "presentacion",
  },
  web: {
    key: "web",
    width: 1280,
    height: 2000,
    label: "Página web",
    description: "Una sola página · se comparte con link",
    multiPage: false,
    primaryExport: "none",
    exportScale: 1,
    safeZone: { top: 0, right: 6, bottom: 0, left: 6 },
    minFontSize: 16,
    group: "web",
  },
};

export function isFormatKey(value: unknown): value is FormatKey {
  return typeof value === "string" && (FORMAT_KEYS as readonly string[]).includes(value);
}

export function formatOf(key: FormatKey): FormatDef {
  return FORMATS[key];
}

/** Si el formato se puede exportar (PDF, imágenes o una página). `web` no exporta. */
export function canExport(key: FormatKey): boolean {
  return FORMATS[key].primaryExport !== "none";
}

/** Las exportaciones que ofrece la barra del editor para el formato (F17, F46). */
export function exportOptions(key: FormatKey): readonly ("pdf" | "zip" | "png")[] {
  return canExport(key) ? ["pdf", "zip", "png"] : [];
}

/** Si el formato es impreso (carta o A4). */
export function isPrintFormat(key: FormatKey): boolean {
  return (PRINT_FORMATS as readonly string[]).includes(key);
}

/** Los formatos que se ofrecen al crear según "una / varias páginas" y si es plantilla (F16). */
export function formatsForNew(opts: { multiPage: boolean; template: boolean }): FormatKey[] {
  return FORMAT_KEYS.filter((key) => {
    const def = FORMATS[key];
    if (key === "web") return !opts.multiPage && !opts.template;
    return opts.multiPage ? def.multiPage : true;
  });
}

/** El máximo de páginas de un documento (Instagram admite 20; TikTok 35, se avisa al usar en contenido). */
export const MAX_PAGES = 20;

/** El ancho del punto de quiebre de una página web publicada (F29). */
export const WEB_BREAKPOINT_PX = 640;
