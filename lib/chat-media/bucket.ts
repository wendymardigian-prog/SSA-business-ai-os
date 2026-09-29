/**
 * El bucket de la media del chat: donde va cada archivo y como se lee (F2).
 *
 * Modulo PURO a proposito: lo importan el receptor del webhook (servidor), la
 * burbuja del mensaje (navegador) y el cron de limpieza. Nada de Supabase ni de
 * Vault entra aca, o la bandeja no compilaria.
 */

export const CHAT_MEDIA_BUCKET = "chat-media";

/** Cuanto vive el link para reproducir. */
export const SIGNED_URL_SECONDS = 15 * 60;

/**
 * Cuanto vive el link de descarga. Es mas corto que el de reproduccion a
 * proposito: un link de descarga se copia y se comparte, y firmado por 15
 * minutos se comparte el acceso al archivo con el link.
 */
export const DOWNLOAD_URL_SECONDS = 5 * 60;

/** El techo de un archivo, en los dos sentidos. Es el limite del bucket. */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

export const TOO_LARGE_MESSAGE = "El archivo supera el máximo de 25 MB";

/**
 * Extension para un mime. Se usa para el nombre del archivo en el bucket: el
 * navegador y algunos reproductores deciden por la extension antes que por el
 * Content-Type.
 */
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/flac": "flac",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
};

export function extensionForMime(mime: string | null | undefined): string {
  if (!mime) return "bin";
  return EXTENSIONS[mime.split(";")[0].trim().toLowerCase()] ?? "bin";
}

/**
 * Donde va el archivo de un adjunto.
 *
 * `<workspace_id>/<conversation_id>/<message_id>-<n>.<ext>`. El primer segmento
 * es el workspace porque es lo unico que mira la policy del bucket: si el path
 * empezara por la conversacion, la policy no tendria con que decidir.
 */
export function mediaPath(args: {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  index: number;
  mime: string | null;
}): string {
  return `${args.workspaceId}/${args.conversationId}/${args.messageId}-${args.index}.${extensionForMime(args.mime)}`;
}

/**
 * Un path que se puede pedir a Storage.
 *
 * Rechaza `..` (salir de la carpeta del workspace) y el `/` inicial (que
 * cambiaria el primer segmento y con eso el workspace que evalua la policy).
 * Se chequea ANTES de tocar Storage.
 */
export function isSafeStoragePath(path: string | null | undefined): path is string {
  if (!path || path.length === 0) return false;
  if (path.startsWith("/")) return false;
  if (path.includes("..")) return false;
  if (path.includes("\\")) return false;
  // Un path valido tiene al menos workspace/algo.
  return path.split("/").length >= 2;
}

/** El nombre de archivo, saneado para usarlo en un path o en una descarga. */
export function safeFilename(name: string | null | undefined, fallback = "adjunto"): string {
  const clean = (name ?? "")
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return clean.length > 0 ? clean : fallback;
}

/** El link que pinta la burbuja: la ruta propia, que firma al abrirla. */
export function chatMediaUrl(storagePath: string): string {
  return `/api/v1/chat-media?path=${encodeURIComponent(storagePath)}`;
}

/** El link de descarga: misma ruta, con el nombre con el que se guarda. */
export function chatMediaDownloadUrl(storagePath: string, filename?: string | null): string {
  const name = filename ? `&name=${encodeURIComponent(safeFilename(filename))}` : "";
  return `/api/v1/chat-media?path=${encodeURIComponent(storagePath)}&download=1${name}`;
}
