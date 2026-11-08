/**
 * Archivos del Diseñador IA (F1, F22, F39, §14a).
 *
 * Dos buckets PRIVADOS (00319). El primer segmento de la ruta es SIEMPRE el
 * workspace (es lo único que lee la política de lectura):
 *   - `design-assets`:  `<ws>/images/<uuid>.<ext>`, `<ws>/fonts/<uuid>.<ext>`, `<ws>/imports/<id>/<archivo>`.
 *   - `design-renders`: `<ws>/<diseño>/<versión>/page-01.png`, `.../document.pdf`, y las exportaciones
 *                       sueltas en `<ws>/<diseño>/exports/<marca>/…` (las limpia `design_cleanup` a los 7 días).
 *
 * Sube y borra SOLO el servidor (cliente de servicio, sin políticas de escritura),
 * después de validar los bytes (nunca la extensión) y el permiso. Los links
 * firmados son de corta duración.
 *
 * Solo servidor.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sniffMime } from "@/lib/content/media";
import type { DesignDoc } from "./doc/schema";
import type { UploadedFont } from "./fonts";

export const DESIGN_ASSETS_BUCKET = "design-assets";
export const DESIGN_RENDERS_BUCKET = "design-renders";

/** 20 MB por imagen subida (F22). */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Duración de un link firmado para el lienzo y el servicio de render: 10 minutos. */
export const SIGNED_URL_SECONDS = 600;

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";
const IMAGE_EXT: Record<ImageMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ImageCheck = { ok: true; mime: ImageMime; ext: string } | { ok: false; error: string };

/**
 * Valida una imagen subida por sus bytes (F22): PNG, JPG o WebP de hasta 20 MB.
 * Un SVG (o cualquier otra cosa) se rechaza con "Usá PNG o JPG".
 */
export function checkImageUpload(bytes: Uint8Array): ImageCheck {
  if (bytes.length === 0) return { ok: false, error: "El archivo está vacío." };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: "La imagen pesa más de 20 MB." };
  const mime = sniffMime(bytes);
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") return { ok: true, mime, ext: IMAGE_EXT[mime] };
  return { ok: false, error: "Usá PNG o JPG (también WebP)." };
}

/** Si una ruta es de este workspace (primer segmento) y no intenta salirse de su carpeta. */
export function pathBelongsTo(path: string, workspaceId: string): boolean {
  if (!UUID_RE.test(workspaceId)) return false;
  if (path.includes("..") || path.includes("//") || path.startsWith("/")) return false;
  return path.split("/")[0] === workspaceId;
}

export function imageAssetPath(workspaceId: string, ext: string): string {
  return `${workspaceId}/images/${randomUUID()}.${ext}`;
}

export function fontAssetPath(workspaceId: string, ext: string): string {
  return `${workspaceId}/fonts/${randomUUID()}.${ext}`;
}

export function importAssetPath(workspaceId: string, importId: string, fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const safe = base.replace(/\.{2,}/g, ".").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(0, 120) || "archivo";
  return `${workspaceId}/imports/${importId}/${safe}`;
}

/** Carpeta de los archivos vigentes de un diseño (una versión). */
export function renderFolder(workspaceId: string, designId: string, version: string): string {
  return `${workspaceId}/${designId}/${version}`;
}

/** Carpeta de una exportación suelta (prueba o descarga de algo no publicado). */
export function exportFolder(workspaceId: string, designId: string, stamp: string): string {
  return `${workspaceId}/${designId}/exports/${stamp}`;
}

export function pageFileName(index: number): string {
  return `page-${String(index + 1).padStart(2, "0")}.png`;
}

/** Todas las rutas de `design-assets` que usa un documento (imágenes, fondos y recursos de un HTML cargado). */
export function collectAssetPaths(doc: DesignDoc, fonts: readonly UploadedFont[] = []): string[] {
  const paths = new Set<string>();
  for (const page of doc.pages) {
    if (page.background.type === "image" && page.background.image) paths.add(page.background.image.asset);
    for (const el of page.elements) {
      if (el.type === "image") paths.add(el.asset);
      if (el.type === "html") {
        for (const m of `${el.html}\n${el.css ?? ""}`.matchAll(/asset:([A-Za-z0-9._\-/]+)/g)) paths.add(m[1]);
      }
    }
  }
  for (const f of fonts) paths.add(f.path);
  return [...paths];
}

type Storage = Pick<SupabaseClient, "storage">;

/**
 * Links firmados para todas las rutas de un documento, de una vez. Una ruta que
 * no es del workspace no se firma (queda vacía): nunca se sirve un archivo ajeno.
 */
export async function signAssetUrls(db: Storage, workspaceId: string, paths: readonly string[], seconds = SIGNED_URL_SECONDS): Promise<Map<string, string>> {
  const mine = paths.filter((p) => pathBelongsTo(p, workspaceId));
  const map = new Map<string, string>();
  if (mine.length === 0) return map;
  const { data, error } = await db.storage.from(DESIGN_ASSETS_BUCKET).createSignedUrls(mine, seconds);
  if (error) {
    console.error("[designer] no pude firmar los archivos del diseño:", error.message);
    return map;
  }
  for (const row of data ?? []) if (row.path && row.signedUrl) map.set(row.path, row.signedUrl);
  return map;
}

/** El `assetUrl` para `renderPageHTML`: la URL firmada, o vacío si no se pudo firmar. */
export function assetUrlFrom(map: ReadonlyMap<string, string>): (path: string) => string {
  return (path) => map.get(path) ?? "";
}

export type UploadResult = { ok: true; path: string; mime: string } | { ok: false; error: string };

/** Sube una imagen validada por bytes a `design-assets/<ws>/images/`. Solo con el cliente de servicio. */
export async function uploadDesignImage(db: Storage, workspaceId: string, bytes: Uint8Array): Promise<UploadResult> {
  const check = checkImageUpload(bytes);
  if (!check.ok) return check;
  const path = imageAssetPath(workspaceId, check.ext);
  const { error } = await db.storage.from(DESIGN_ASSETS_BUCKET).upload(path, bytes, { contentType: check.mime, upsert: false });
  if (error) {
    console.error("[designer] no pude subir la imagen:", error.message);
    return { ok: false, error: "No se pudo subir la imagen. Probá de nuevo." };
  }
  return { ok: true, path, mime: check.mime };
}
