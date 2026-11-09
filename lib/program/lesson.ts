// @plantilla-quitar(servicios)
/**
 * Lo que se sube a una clase (F46, F112), puro: cada archivo se valida por sus BYTES, nunca por la extensión.
 * También la vista previa de una clase: la propia, si no la del video, si no el ícono del tipo.
 */
import { sniffMime, sniffUploadMime } from "@/lib/content/media";

export const HTML_MAX = 1024 * 1024;
export const DOCUMENT_MAX = 20 * 1024 * 1024;
export const IMAGE_MAX = 2 * 1024 * 1024;
export const RESOURCE_MAX = 20 * 1024 * 1024;

export type UploadCheck = { ok: true; mime: string } | { ok: false; error: string };

export function checkHtml(bytes: Uint8Array): UploadCheck {
  if (bytes.length > HTML_MAX) return { ok: false, error: "La página tiene hasta 1 MB" };
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 512)).toLowerCase();
  if (bytes.some((b) => b === 0)) return { ok: false, error: "Eso no es una página HTML" };
  if (!/<(?:!doctype|html|head|body|div|p|h[1-6]|section|main|style|span|img|table|ul)/.test(head) && !head.trim().startsWith("<")) {
    return { ok: false, error: "Eso no es una página HTML" };
  }
  return { ok: true, mime: "text/html" };
}

export function checkDocument(bytes: Uint8Array): UploadCheck {
  if (bytes.length > DOCUMENT_MAX) return { ok: false, error: "El documento tiene hasta 20 MB" };
  return sniffMime(bytes) === "application/pdf" ? { ok: true, mime: "application/pdf" } : { ok: false, error: "Eso no es un PDF" };
}

export function checkImage(bytes: Uint8Array): UploadCheck {
  if (bytes.length > IMAGE_MAX) return { ok: false, error: "La imagen tiene hasta 2 MB" };
  const m = sniffUploadMime(bytes);
  return m === "image/jpeg" || m === "image/png" || m === "image/webp" ? { ok: true, mime: m } : { ok: false, error: "La imagen tiene que ser JPG, PNG o WebP" };
}

export function checkResource(bytes: Uint8Array, declaredMime?: string | null): UploadCheck {
  if (bytes.length > RESOURCE_MAX) return { ok: false, error: "Cada recurso tiene hasta 20 MB" };
  const m = sniffUploadMime(bytes, declaredMime);
  return m ? { ok: true, mime: m } : { ok: false, error: "No reconozco ese tipo de archivo" };
}

export const LESSON_TYPE_LABELS: Record<string, string> = {
  video: "Video",
  html: "Página",
  document: "Documento",
  quiz: "Evaluación",
  activity: "Actividad",
};

/** La vista previa de una clase (F112): la propia; si no, la del video; si no, el ícono de su tipo. */
export function lessonThumbnail(item: { thumbnail_path?: string | null; thumbnail_url?: string | null; lesson_type?: string | null }): { kind: "own"; path: string } | { kind: "video"; url: string } | { kind: "icon"; type: string } {
  if (item.thumbnail_path) return { kind: "own", path: item.thumbnail_path };
  if (item.thumbnail_url) return { kind: "video", url: item.thumbnail_url };
  return { kind: "icon", type: item.lesson_type ?? "video" };
}

/** La ruta de un archivo de un programa: `<negocio>/<producto>/<item>/<nombre>` (el primer segmento es el negocio). */
export function programPath(workspaceId: string, productId: string, itemId: string, name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 80) || "archivo";
  return `${workspaceId}/${productId}/${itemId}/${safe}`;
}
