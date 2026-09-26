/**
 * Los adjuntos de un correo, para mostrarlos y bajarlos (F64).
 *
 * Se guardan en `messages.attachments` como `{ files: [...] }`, con el path
 * en nuestro bucket y no una URL: las URLs firmadas vencen, y una guardada
 * en la fila dejaria de funcionar sin que nada lo indique. Se firma al
 * mostrar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { ATTACHMENTS_BUCKET } from "./buckets";

type Db = SupabaseClient<Database>;

/** Cuanto vive el link de descarga. */
export const SIGNED_URL_SECONDS = 15 * 60;

export interface AttachmentRef {
  filename: string;
  contentType: string;
  storagePath: string;
  sizeBytes: number | null;
}

/** Lee los adjuntos de un mensaje, sin romperse con lo que sea que haya. */
export function parseAttachments(value: unknown): AttachmentRef[] {
  const files = (value as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];

  return files
    .filter((file): file is Record<string, unknown> => typeof file === "object" && file !== null)
    .map((file) => ({
      filename: String(file.filename ?? "adjunto"),
      contentType: String(file.contentType ?? "application/octet-stream"),
      storagePath: String(file.storagePath ?? ""),
      sizeBytes: typeof file.sizeBytes === "number" ? file.sizeBytes : null,
    }))
    .filter((file) => file.storagePath.length > 0);
}

/** El tamaño en palabras: "1,2 MB". */
export function humanSize(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Los links de descarga, firmados al momento.
 *
 * La RLS del bucket decide: si quien pide no es del workspace, Storage no
 * firma. No hace falta chequear nada de este lado.
 */
export async function signAttachments(
  supabase: Db,
  attachments: AttachmentRef[],
): Promise<Array<AttachmentRef & { url: string | null }>> {
  if (attachments.length === 0) return [];

  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrls(
      attachments.map((a) => a.storagePath),
      SIGNED_URL_SECONDS,
    );

  if (error) {
    console.error("[email] no pude firmar los adjuntos:", error.message);
    return attachments.map((a) => ({ ...a, url: null }));
  }

  return attachments.map((attachment, index) => ({
    ...attachment,
    url: data?.[index]?.signedUrl ?? null,
  }));
}
