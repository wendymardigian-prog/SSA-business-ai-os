/**
 * Qué se puede descargar del link público de un diseño (F43, F44).
 *
 * Puro: lo usan la página (para dibujar el botón), la ruta `/d/<código>/descargar` (para decidir) y los tests.
 * El archivo en sí sale del bucket `design-renders` por streaming; acá solo se decide qué pedir y cómo se llama.
 */

import { FORMATS, canExport, type FormatKey } from "../formats";
import { exportDownloadName, slugifyFileName } from "../export";

export type DownloadFormat = "pdf" | "zip" | "png";

export interface DownloadOption {
  formato: DownloadFormat;
  /** Texto del botón. */
  label: string;
  /** Solo `png`: la página (1 = la primera). */
  pagina?: number;
}

/** Lo principal que se descarga: PDF en impresos y presentaciones; imágenes en redes (un ZIP si son varias). */
export function primaryDownload(format: FormatKey, pageCount: number): DownloadOption | null {
  if (!canExport(format)) return null;
  if (FORMATS[format].primaryExport === "pdf") return { formato: "pdf", label: "Descargar PDF" };
  return pageCount > 1 ? { formato: "zip", label: "Descargar imágenes (ZIP)" } : { formato: "png", label: "Descargar imagen", pagina: 1 };
}

export type DownloadQuery = { ok: true; formato: DownloadFormat; pagina: number } | { ok: false };

/**
 * Lee `?formato=pdf|zip|png&pagina=N`. Sin `formato` se baja lo principal. `pagina` es 1-based y solo importa
 * con `png`. Cualquier cosa rara es `ok: false` (la ruta responde 404, igual que un código inexistente).
 */
export function parseDownloadQuery(params: URLSearchParams, format: FormatKey, pageCount: number): DownloadQuery {
  const primary = primaryDownload(format, pageCount);
  if (!primary) return { ok: false };
  const raw = params.get("formato");
  const formato = raw === null || raw === "" ? primary.formato : raw;
  if (formato !== "pdf" && formato !== "zip" && formato !== "png") return { ok: false };
  if (formato === "zip" && pageCount < 2) return { ok: false };
  let pagina = 1;
  if (formato === "png") {
    const rawPage = params.get("pagina");
    if (rawPage !== null && rawPage !== "") {
      if (!/^\d{1,3}$/.test(rawPage)) return { ok: false };
      pagina = Number(rawPage);
    }
    if (pagina < 1 || pagina > pageCount) return { ok: false };
  }
  return { ok: true, formato, pagina };
}

/**
 * El nombre del archivo que se baja: `certificado-ana-perez.pdf`. Un PNG de una pieza de varias páginas lleva
 * su número; el de una sola, no.
 */
export function publicDownloadName(designName: string, formato: DownloadFormat, pagina: number, pageCount: number): string {
  return exportDownloadName(designName, formato, formato === "png" && pageCount > 1 ? pagina - 1 : undefined);
}

/** `Content-Disposition` con un nombre ASCII (sin comillas, barras ni saltos de línea, pase lo que pase). */
export function attachmentHeader(fileName: string): string {
  const extension = fileName.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? "";
  const safe = `${slugifyFileName(extension ? fileName.slice(0, -extension.length) : fileName)}${extension.toLowerCase()}`;
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export function contentTypeOf(formato: DownloadFormat): string {
  return formato === "pdf" ? "application/pdf" : formato === "zip" ? "application/zip" : "image/png";
}
