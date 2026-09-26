/**
 * La media de una pieza (F18).
 *
 * Lo importante de este archivo es que el tipo del archivo se decide por su
 * CONTENIDO y no por su nombre. La extension y el `Content-Type` que manda el
 * navegador los elige quien sube: renombrar `algo.exe` a `algo.png` es
 * gratis. Los primeros bytes de un archivo, no.
 *
 * Todo puro: recibe bytes y devuelve decisiones. Quien sube y quien borra es
 * `lib/actions/content-media.ts`.
 */

/** Lo que se puede subir, con su firma en los primeros bytes. */
export const ALLOWED_MEDIA = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "image/gif": { ext: "gif", kind: "image" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/quicktime": { ext: "mov", kind: "video" },
  "application/pdf": { ext: "pdf", kind: "document" },
} as const;

export type AllowedMime = keyof typeof ALLOWED_MEDIA;
export type MediaKind = (typeof ALLOWED_MEDIA)[AllowedMime]["kind"];

/** 1 GB. Es el limite del bucket y el de la mayoria de las redes. */
export const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;

/** Desde aca la subida va por partes (TUS). Es el limite de una subida simple. */
export const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024;

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  signature.every((byte, i) => bytes[offset + i] === byte);

/**
 * El tipo real de un archivo, mirando sus primeros bytes.
 *
 * Devuelve null si no reconoce la firma, y eso se trata como "no permitido":
 * es preferible rechazar algo valido raro a aceptar cualquier cosa.
 */
export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";

  // GIF87a / GIF89a
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";

  // PDF: %PDF-
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";

  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }

  // MP4 y MOV comparten la caja "ftyp" en el byte 4; los distingue la marca
  // que sigue. `qt  ` es QuickTime; el resto de las marcas conocidas, MP4.
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }

  return null;
}

export interface MediaCandidate {
  fileName: string;
  sizeBytes: number;
  /** Los primeros bytes del archivo. Con 16 alcanza para todas las firmas. */
  head: Uint8Array;
  /** Lo que dice el navegador. Se usa solo para explicar el error. */
  declaredMime?: string;
}

export type MediaValidation =
  | { ok: true; mime: AllowedMime; kind: MediaKind; ext: string; resumable: boolean }
  | { ok: false; error: string };

export function validateMedia(candidate: MediaCandidate): MediaValidation {
  if (candidate.sizeBytes <= 0) {
    return { ok: false, error: "El archivo esta vacio" };
  }
  if (candidate.sizeBytes > MAX_MEDIA_BYTES) {
    const gb = (candidate.sizeBytes / (1024 * 1024 * 1024)).toFixed(2);
    return { ok: false, error: `El archivo pesa ${gb} GB y el maximo es 1 GB` };
  }

  const mime = sniffMime(candidate.head);
  if (!mime) {
    return {
      ok: false,
      error: candidate.declaredMime
        ? `No puedo reconocer el archivo. Dice ser ${candidate.declaredMime}, pero su contenido no lo parece.`
        : "No reconozco ese tipo de archivo. Se aceptan jpg, png, webp, gif, mp4, mov y pdf.",
    };
  }

  const definition = ALLOWED_MEDIA[mime];
  return {
    ok: true,
    mime,
    kind: definition.kind,
    ext: definition.ext,
    resumable: candidate.sizeBytes > RESUMABLE_THRESHOLD_BYTES,
  };
}

/**
 * Donde se guarda un archivo.
 *
 * El primer segmento es el workspace, y no por prolijidad: es lo que miran
 * las policies del bucket para decidir quien escribe donde (migracion 00083).
 * El nombre se genera: dos personas subiendo "video.mp4" no se pisan, y un
 * nombre original con acentos o barras no rompe la ruta.
 */
export function mediaPath(params: {
  workspaceId: string;
  postId: string;
  ext: string;
  uniqueId: string;
}): string {
  return `${params.workspaceId}/${params.postId}/${params.uniqueId}.${params.ext}`;
}

/** Que el path pertenezca a ese workspace. Se valida antes de borrar. */
export function pathBelongsToWorkspace(path: string, workspaceId: string): boolean {
  return path.startsWith(`${workspaceId}/`) && !path.includes("..");
}

export interface MediaEntry {
  storage_path: string;
  mime_type: string;
  kind: MediaKind;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  is_cover?: boolean;
  alt_text?: string | null;
  deleted_at?: string | null;
}

/** La media viva de una pieza (la borrada queda marcada, no desaparece). */
export function liveMedia(media: MediaEntry[]): MediaEntry[] {
  return media.filter((m) => !m.deleted_at);
}

/**
 * Que hacer al sacar una media de una pieza.
 *
 * Si la pieza no se publico, el archivo se borra del bucket: nadie lo va a
 * extrañar y ocupa lugar. Si ya se publico, se marca y se conserva, porque
 * puede ser lo que se ve en la red y porque el analisis del post lo muestra.
 */
export function removalPlan(params: {
  media: MediaEntry[];
  storagePath: string;
  postPublished: boolean;
}): { media: MediaEntry[]; deleteFromBucket: boolean; found: boolean } {
  const found = params.media.some((m) => m.storage_path === params.storagePath);
  if (!found) return { media: params.media, deleteFromBucket: false, found: false };

  if (params.postPublished) {
    return {
      media: params.media.map((m) =>
        m.storage_path === params.storagePath
          ? { ...m, deleted_at: new Date().toISOString() }
          : m,
      ),
      deleteFromBucket: false,
      found: true,
    };
  }

  return {
    media: params.media.filter((m) => m.storage_path !== params.storagePath),
    deleteFromBucket: true,
    found: true,
  };
}
