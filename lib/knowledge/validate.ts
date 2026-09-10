/**
 * Validacion de lo que se sube a la base de conocimiento (F16).
 *
 * Funciones puras, sin dependencias de servidor, para que el cliente y el
 * servidor validen con LAS MISMAS reglas: el cliente para dar feedback rapido,
 * el servidor porque el cliente se puede saltear. Mismo criterio que
 * lib/integrations/providers.ts.
 */

import { MAX_FILE_BYTES, SUPPORTED_MIMES, MIME_LABELS, type SupportedMime } from "./extract";

export { MAX_FILE_BYTES, SUPPORTED_MIMES, MIME_LABELS };
export type { SupportedMime };

export const MAX_TITLE_LENGTH = 200;
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

/** Extensiones que ofrece el selector de archivos. Es comodidad, no seguridad. */
export const ACCEPTED_EXTENSIONS = ".pdf,.docx,.txt,.md,.markdown";

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** El tamano en algo que se lea: "12,4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * El tamano del archivo.
 *
 * Es lo unico que se puede chequear en el cliente antes de subir; el tipo real
 * necesita leer los bytes, y eso pasa en el servidor.
 */
export function validateFileSize(bytes: number): ValidationResult {
  if (bytes <= 0) return { ok: false, error: "El archivo esta vacio." };

  if (bytes > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `El archivo pesa ${formatBytes(bytes)} y el maximo es ${formatBytes(MAX_FILE_BYTES)}.`,
    };
  }

  return { ok: true };
}

/** El titulo del documento. Si no lo escriben, sale del nombre del archivo. */
export function validateTitle(raw: string): ValidationResult {
  const title = raw.trim();

  if (!title) return { ok: false, error: "El documento necesita un titulo." };

  if (title.length > MAX_TITLE_LENGTH) {
    return {
      ok: false,
      error: `El titulo es muy largo (maximo ${MAX_TITLE_LENGTH} caracteres).`,
    };
  }

  return { ok: true };
}

/**
 * Limpia y normaliza las etiquetas.
 *
 * En minuscula y sin repetidos, para que "Precios" y "precios" no queden como
 * dos etiquetas distintas en el filtro.
 */
export function normalizeTags(raw: string[] | string): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(",");

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const item of list) {
    const tag = item.trim().toLowerCase().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }

  return tags;
}

/** El titulo por defecto: el nombre del archivo sin la extension. */
export function titleFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return base.replace(/[_-]+/g, " ").trim().slice(0, MAX_TITLE_LENGTH) || filename;
}

/**
 * Ruta dentro del bucket.
 *
 * Va namespaceada por workspace y el nombre lo pone el servidor a partir del id
 * del documento: el nombre original del archivo NUNCA entra en la ruta, porque
 * es texto que elige quien sube y podria traer "../" o caracteres que
 * signifiquen algo para el storage.
 */
export function storagePathFor(
  workspaceId: string,
  documentId: string,
  mime: SupportedMime,
): string {
  const extension = extensionForMime(mime);
  return `${workspaceId}/${documentId}.${extension}`;
}

function extensionForMime(mime: SupportedMime): string {
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "text/markdown":
      return "md";
    case "text/plain":
      return "txt";
  }
}
