/**
 * Los anchos de las columnas de la lista de Agenda. PURO: sin DOM ni storage.
 *
 * Cada persona ajusta el ancho arrastrando el borde del encabezado; lo elegido
 * se guarda en su navegador (solo lo que difiere del ancho normal). Un ancho
 * que no se puede leer, o que no es un numero, vuelve al normal: nunca rompe la tabla.
 */

export const BASE_COLUMN_KEYS = ["when", "contact", "event", "category", "host", "status", "origin"] as const;
export type BaseColumnKey = (typeof BASE_COLUMN_KEYS)[number];

/** El ancho normal de cada columna fija, en pixeles. El evento es el que mas texto lleva. */
export const DEFAULT_COLUMN_WIDTHS: Record<BaseColumnKey, number> = {
  when: 270,
  contact: 180,
  event: 280,
  category: 160,
  host: 150,
  status: 190,
  origin: 120,
};

/** El ancho normal de una columna de atribucion (UTM, Meta). */
export const EXTRA_COLUMN_WIDTH = 150;

export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 640;

export type ColumnWidths = Readonly<Record<string, number>>;

export function clampWidth(px: number): number {
  if (!Number.isFinite(px)) return MIN_COLUMN_WIDTH;
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(px)));
}

export function defaultColumnWidth(key: string): number {
  return (DEFAULT_COLUMN_WIDTHS as Record<string, number>)[key] ?? EXTRA_COLUMN_WIDTH;
}

/** El ancho de una columna: el que eligio la persona o el normal. */
export function columnWidth(key: string, widths: ColumnWidths): number {
  const saved = widths[key];
  return typeof saved === "number" ? clampWidth(saved) : defaultColumnWidth(key);
}

/** Lo guardado, tal como lo leyo el navegador. Cualquier cosa rara es "nada guardado". */
export function parseColumnWidths(raw: string | null | undefined): ColumnWidths {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = clampWidth(value);
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeColumnWidths(widths: ColumnWidths): string {
  return JSON.stringify(widths);
}

/** Guarda un ancho nuevo; si queda igual al normal, no se guarda (asi "restablecer" no deja rastro). */
export function setColumnWidth(widths: ColumnWidths, key: string, px: number): ColumnWidths {
  const next = { ...widths };
  const value = clampWidth(px);
  if (value === defaultColumnWidth(key)) delete next[key];
  else next[key] = value;
  return next;
}

export function resetColumnWidth(widths: ColumnWidths, key: string): ColumnWidths {
  const next = { ...widths };
  delete next[key];
  return next;
}

/** Lo que mide la tabla entera: la suma de sus columnas. */
export function totalWidth(keys: readonly string[], widths: ColumnWidths, live?: { key: string; width: number } | null): number {
  return keys.reduce((sum, key) => sum + (live && live.key === key ? clampWidth(live.width) : columnWidth(key, widths)), 0);
}
