/**
 * Archivos adjuntos de las notas de la ficha del cliente (00520) y de los comentarios de las tareas (00521). PURO: lo
 * importa también el navegador (el elegir de archivos), y el servidor vuelve a mirar todo antes de subir.
 *
 * Hasta 5 archivos por nota o comentario, de 25 MB cada uno: imágenes, PDF u Office. El tipo se decide por los BYTES
 * (`sniffUploadMime`), nunca por la extensión: un Office se reconoce por su contenedor (ZIP u OLE) más el tipo que
 * declara el navegador, o, si el navegador no declara nada, el que corresponde a la extensión.
 */
import { sniffUploadMime } from "@/lib/content/media";

export const RECORD_ATTACHMENTS_BUCKET = "record-attachments";
export const RECORD_ATTACHMENTS_MAX = 5;
export const RECORD_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
/** El enlace de descarga vale 5 minutos. */
export const RECORD_ATTACHMENT_SIGNED_SECONDS = 300;
export const RECORD_ATTACHMENT_ACCEPT =
  "image/jpeg,image/png,image/gif,image/webp,image/heic,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const BY_EXTENSION: Record<string, string> = {
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export interface RecordAttachmentView {
  id: string;
  name: string;
}

/** Qué archivos elegidos se pueden mandar: hasta 5 y de 25 MB como mucho. PURO. */
export function pickRecordFiles<T extends { size: number; name: string }>(files: T[]): { ok: T[]; error: string | null } {
  const tooBig = files.filter((f) => f.size > RECORD_ATTACHMENT_MAX_BYTES);
  const ok = files.filter((f) => f.size > 0 && f.size <= RECORD_ATTACHMENT_MAX_BYTES).slice(0, RECORD_ATTACHMENTS_MAX);
  const error = tooBig.length
    ? `«${tooBig[0].name}» pesa más de 25 MB.`
    : files.length > RECORD_ATTACHMENTS_MAX
      ? `Se pueden adjuntar como máximo ${RECORD_ATTACHMENTS_MAX} archivos.`
      : null;
  return { ok, error };
}

/** El tipo real del archivo, o el motivo por el que no se acepta. `bytes`: los primeros (64 alcanzan). PURO. */
export function classifyRecordFile(
  bytes: Uint8Array,
  declaredMime: string | null | undefined,
  fileName: string,
  size: number,
): { ok: true; mime: string } | { ok: false; error: string } {
  if (size <= 0) return { ok: false, error: "El archivo está vacío." };
  if (size > RECORD_ATTACHMENT_MAX_BYTES) return { ok: false, error: "El archivo puede pesar hasta 25 MB." };
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const declared = (declaredMime ?? "").split(";")[0].trim().toLowerCase();
  // Un Office sin tipo declarado (o con uno genérico) se reconoce por la extensión; los bytes lo siguen decidiendo.
  const hint = declared && declared !== "application/octet-stream" && declared !== "application/zip" ? declared : (BY_EXTENSION[ext] ?? declared);
  const mime = sniffUploadMime(bytes, hint);
  if (!mime || !ALLOWED.has(mime)) return { ok: false, error: "Subí una imagen, un PDF o un archivo de Word, Excel o PowerPoint." };
  return { ok: true, mime };
}

/** El nombre del archivo, sin rutas ni caracteres raros, hasta 200. PURO. */
export function cleanRecordFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return (clean || "archivo").slice(0, 200);
}

/** La ruta en el bucket: siempre dentro del negocio y de la carpeta de la nota o del comentario. */
export function recordAttachmentPath(workspaceId: string, folder: string, fileId: string, name: string): string {
  const safe = cleanRecordFileName(name).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "archivo";
  return `${workspaceId}/${folder}/${fileId}-${safe}`;
}
