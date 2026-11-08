/**
 * Exportar un diseño (F46): qué se le pide al servicio de render, con qué escala, cuántas páginas y cómo se
 * llaman los archivos.
 *
 * - **PDF**: todas las páginas, una hoja por página, al tamaño real del formato (impresos ×1, redes y
 *   presentaciones ×2).
 * - **Imágenes (ZIP)**: un PNG por página (`01.png`, `02.png`…) en un `imagenes.zip`.
 * - **Solo esta página (PNG)**: una sola página.
 * - Una página web (`web`) no se exporta: se comparte con su link.
 *
 * `exportPlan` es la MISMA cuenta que hace el job `design_render` (`lib/designer/jobs/render.ts`): un test los
 * compara para que nunca se desfasen. Módulo puro (lo usan las acciones, el link público y los tests).
 */

import type { DesignDoc } from "./doc/schema";
import { FORMATS, canExport, type FormatKey } from "./formats";
import { pageFileName } from "./storage";

export type ExportKind = "pdf" | "zip" | "png";

export const EXPORT_KINDS: readonly ExportKind[] = ["pdf", "zip", "png"];

export function isExportKind(value: unknown): value is ExportKind {
  return typeof value === "string" && (EXPORT_KINDS as readonly string[]).includes(value);
}

export const WEB_NOT_EXPORTABLE = "Una página web se comparte con su link";
export const PAGE_NOT_FOUND = "Esa página no existe en este diseño";

/** Un pedido al servicio de render. */
export interface ExportRequest {
  format: "png" | "pdf";
  /** Las páginas que entran en ESTE pedido (0 = la primera), en orden. */
  pages: number[];
  width: number;
  height: number;
  scale: 1 | 2;
}

export type ExportPlan =
  | {
      ok: true;
      kind: ExportKind;
      format: FormatKey;
      scale: 1 | 2;
      width: number;
      height: number;
      pageCount: number;
      /** Las páginas que entran en el archivo. */
      pages: number[];
      requests: ExportRequest[];
      /** El archivo que deja el job en `design-renders/<ws>/<pieza>/exports/<marca>/`. */
      stored: { file: string; contentType: string };
      /** Los nombres de adentro del ZIP (`01.png`, `02.png`…); null si no es un ZIP. */
      inner: string[] | null;
    }
  | { ok: false; error: string };

/** El archivo que deja una exportación en su carpeta, sin necesitar el documento. */
export function storedExportFile(kind: ExportKind, page = 0): { file: string; contentType: string } {
  if (kind === "pdf") return { file: "document.pdf", contentType: "application/pdf" };
  if (kind === "zip") return { file: "imagenes.zip", contentType: "application/zip" };
  return { file: pageFileName(Math.max(0, Math.floor(page))), contentType: "image/png" };
}

/** `exportPlan(doc, kind, page)`: los pedidos correctos al servicio. `page` es 0-based y solo cuenta en `png`. */
export function exportPlan(doc: DesignDoc, kind: ExportKind, page?: number): ExportPlan {
  const format = FORMATS[doc.format];
  if (!canExport(doc.format)) return { ok: false, error: WEB_NOT_EXPORTABLE };
  const pageCount = doc.pages.length;
  const all = Array.from({ length: pageCount }, (_, i) => i);
  const base = { format: doc.format, scale: format.exportScale, width: format.width, height: format.height, pageCount };
  const request = (type: "png" | "pdf", pages: number[]): ExportRequest => ({ format: type, pages, width: format.width, height: format.height, scale: format.exportScale });

  if (kind === "pdf") return { ok: true, kind, ...base, pages: all, requests: [request("pdf", all)], stored: storedExportFile("pdf"), inner: null };
  if (kind === "zip") {
    return { ok: true, kind, ...base, pages: all, requests: [request("png", all)], stored: storedExportFile("zip"), inner: all.map((i) => `${String(i + 1).padStart(2, "0")}.png`) };
  }
  const index = page ?? 0;
  if (!Number.isInteger(index) || index < 0 || index >= pageCount) return { ok: false, error: PAGE_NOT_FOUND };
  return { ok: true, kind, ...base, pages: [index], requests: [request("png", [index])], stored: storedExportFile("png", index), inner: null };
}

// ─── Nombres de archivo ─────────────────────────────────────────────────────

/** Un nombre de archivo legible: sin tildes, en minúscula y con guiones (`Certificado · Ana Pérez` → `certificado-ana-perez`). */
export function slugifyFileName(name: string, fallback = "diseno"): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || fallback;
}

/**
 * Cómo se llama el archivo que se baja. `page` (0-based) solo se pasa cuando la persona pidió UNA página de un
 * diseño de varias; sin ella, el PNG es el diseño entero (`certificado-ana-perez.png`).
 */
export function exportDownloadName(designName: string, kind: ExportKind, page?: number): string {
  const slug = slugifyFileName(designName);
  if (kind === "pdf") return `${slug}.pdf`;
  if (kind === "zip") return `${slug}-imagenes.zip`;
  return page === undefined ? `${slug}.png` : `${slug}-pagina-${Math.max(0, Math.floor(page)) + 1}.png`;
}

// ─── La marca de una exportación ────────────────────────────────────────────

/** Una exportación vive en `exports/<marca>/`: `<milisegundos>-<azar>`. La arma quien la pide, así sabe dónde buscarla. */
export const EXPORT_STAMP_RE = /^\d{10,16}-[a-z0-9]{4,8}$/;

export function newExportStamp(now: Date = new Date(), random: () => number = Math.random): string {
  return `${now.getTime()}-${random().toString(36).slice(2, 8).padEnd(4, "0")}`;
}

export function isValidExportStamp(stamp: unknown): stamp is string {
  return typeof stamp === "string" && EXPORT_STAMP_RE.test(stamp);
}

/** Cuánto lleva pidiéndose la exportación (a partir de su marca), o null si la marca no es nuestra. */
export function exportStampAgeMs(stamp: string, now: Date = new Date()): number | null {
  if (!isValidExportStamp(stamp)) return null;
  const startedAt = Number(stamp.split("-")[0]);
  return Number.isFinite(startedAt) ? Math.max(0, now.getTime() - startedAt) : null;
}

/**
 * Pasado este tiempo sin archivo ni `error.json`, `exportStatus` deja de decir "preparando": los reintentos del
 * job son a 1, 5 y 15 minutos (21 en total) y después no hay nada más que esperar.
 */
export const EXPORT_GIVE_UP_MS = 25 * 60_000;
