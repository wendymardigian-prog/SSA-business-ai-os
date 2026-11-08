/**
 * Lo que `inspectHtmlUpload` deja guardado para `importHtml` (F39–F42): el HTML ya limpio y marcado,
 * su CSS y lo que se detectó. Vive en `design-assets/<ws>/imports/<uploadId>/import.json`.
 *
 * Se vuelve a validar al leerlo (es un archivo, aunque lo haya escrito el servidor).
 *
 * Módulo puro.
 */

import { z } from "zod";
import { FORMAT_KEYS } from "../formats";

const MAX_HTML = 2_000_000;
const MAX_CSS = 500_000;

export const importRecordSchema = z.object({
  v: z.literal(1),
  fileName: z.string().max(300),
  html: z.string().max(MAX_HTML),
  css: z.string().max(MAX_CSS),
  detected: z.object({
    as: z.enum(["web", "slides"]),
    format: z.enum(FORMAT_KEYS),
    pages: z.number().int().min(1).max(10_000),
    label: z.string().max(200),
    sizePx: z.object({ w: z.number().positive(), h: z.number().positive() }).nullable(),
    reason: z.string().max(200),
  }),
  removed: z.object({
    scripts: z.number().int().min(0),
    iframes: z.number().int().min(0),
    forms: z.number().int().min(0),
    other: z.number().int().min(0),
    summary: z.string().max(1000).nullable(),
  }),
  assets: z.object({ images: z.number().int().min(0), fonts: z.number().int().min(0), skipped: z.number().int().min(0) }),
});

export type ImportRecord = z.infer<typeof importRecordSchema>;

export const IMPORT_RECORD_FILE = "import.json";

export function parseImportRecord(json: unknown): ImportRecord | null {
  const parsed = importRecordSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
