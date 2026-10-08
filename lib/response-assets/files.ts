/**
 * Que archivo acepta cada tipo de recurso, decidido por su CONTENIDO.
 *
 * Puro: lo usan la subida a la banca (lib/actions/response-assets.ts, que
 * re-sniffea en el servidor) y el formulario (para el `accept` del input y
 * para avisar antes de subir).
 *
 * Todo lo de aca tiene que estar tambien en el `allowed_mime_types` del bucket
 * chat-media (00102): si no, la subida firmada falla en Storage con un error
 * que la persona no entiende.
 */

import { MAX_CHAT_UPLOAD_BYTES } from "@/lib/chat-media/bucket";
import type { AssetKind } from "./kind";

/** El tope de un archivo de la banca: el mismo del composer (16 MB). */
export const MAX_ASSET_BYTES = MAX_CHAT_UPLOAD_BYTES;

export type FileAssetKind = Extract<AssetKind, "audio" | "video" | "image" | "file">;

export const ACCEPTED_MIMES: Record<FileAssetKind, readonly string[]> = {
  // Los que sniffMime reconoce como audio.
  audio: ["audio/ogg", "audio/webm", "audio/mpeg", "audio/wav", "audio/mp4"],
  video: ["video/mp4", "video/quicktime", "video/webm", "video/3gpp"],
  // HEIC no: Instagram y WhatsApp no la muestran bien (ver `fileRejection`).
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  file: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
};

/** El `accept` del input de archivo. Es una ayuda para elegir, no un control. */
export const ACCEPT_ATTRIBUTE: Record<FileAssetKind, string> = {
  audio: "audio/*",
  video: "video/mp4,video/quicktime,video/webm,video/3gpp,.mp4,.mov,.webm,.3gp",
  image: "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif",
  file: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx",
};

/** Lo que se le dice a la persona: que formatos entran, en criollo. */
export const ACCEPTED_FORMATS_LABEL: Record<FileAssetKind, string> = {
  audio: "OGG, MP3, M4A, WAV o WebM",
  video: "MP4, MOV o WebM",
  image: "JPG, PNG, WebP o GIF",
  file: "PDF, Word, Excel o PowerPoint",
};

export function isFileAssetKind(kind: AssetKind): kind is FileAssetKind {
  return kind === "audio" || kind === "video" || kind === "image" || kind === "file";
}

export function mimeMatchesKind(kind: FileAssetKind, mime: string | null | undefined): boolean {
  const clean = (mime ?? "").split(";")[0].trim().toLowerCase();
  return ACCEPTED_MIMES[kind].includes(clean);
}

/**
 * Por que no entra este archivo, o null si entra. `sniffed` es lo que dijo
 * `sniffUploadMime` (null = no reconocido).
 */
export function fileRejection(kind: FileAssetKind, sniffed: string | null, sizeBytes: number): string | null {
  if (sizeBytes <= 0) return "El archivo está vacío";
  if (sizeBytes > MAX_ASSET_BYTES) {
    const mb = (sizeBytes / (1024 * 1024)).toFixed(1);
    return `El archivo pesa ${mb} MB y el máximo es 16 MB`;
  }
  if (sniffed === "image/heic") {
    return "Esa foto está en formato HEIC (el de los iPhone), que Instagram y WhatsApp no muestran bien. Convertila a JPG o PNG y subila de nuevo.";
  }
  if (!sniffed || !mimeMatchesKind(kind, sniffed)) {
    return `Ese archivo no es ${KIND_ARTICLE[kind]} reconocible. Se aceptan ${ACCEPTED_FORMATS_LABEL[kind]}.`;
  }
  return null;
}

const KIND_ARTICLE: Record<FileAssetKind, string> = {
  audio: "un audio",
  video: "un video",
  image: "una imagen",
  file: "un documento",
};

/** "2,4 MB" / "830 KB", para la lista y el preview. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** El nombre corto del formato ("PDF", "Excel"), para la fila de un archivo. */
export function formatLabel(mime: string | null | undefined): string {
  const clean = (mime ?? "").split(";")[0].trim().toLowerCase();
  if (clean === "application/pdf") return "PDF";
  if (clean.includes("word")) return "Word";
  if (clean.includes("excel") || clean.includes("spreadsheet")) return "Excel";
  if (clean.includes("powerpoint") || clean.includes("presentation")) return "PowerPoint";
  const sub = clean.split("/")[1];
  return sub ? sub.toUpperCase() : "";
}
