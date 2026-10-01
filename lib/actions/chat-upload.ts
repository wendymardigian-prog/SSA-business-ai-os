"use server";

import { randomUUID } from "node:crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { sniffMime } from "@/lib/content/media";
import { CHAT_MEDIA_BUCKET, MAX_CHAT_UPLOAD_BYTES, extensionForMime } from "@/lib/chat-media/bucket";
import type { AttachmentKind } from "@/lib/messages/attachments";

/**
 * Autorizar la subida de un audio grabado o un archivo adjuntado del disco,
 * directo del navegador a `chat-media` (F19).
 *
 * El patron es el de `lib/actions/content-media.ts`: la subida no pasa por el
 * servidor (evita el limite de body de una Server Action), y lo que decide el
 * servidor es SI se puede subir y A DONDE.
 *
 * La diferencia con content-media: `chat-media` no tiene policies de
 * escritura (migracion 00102, a proposito). `createSignedUploadUrl` se firma
 * con el SERVICE ROLE; la conversacion se lee antes con el cliente del
 * USUARIO, para que sea la RLS la que decida si puede mandar ahi.
 */

export type ChatUploadResult =
  | { ok: true; path: string; mime: string; kind: AttachmentKind; token: string }
  | { ok: false; error: string };

/** audio -> "voice" si viene del grabador (F18), "audio" si es un archivo adjuntado. */
function kindForUpload(mime: string, isRecording: boolean): AttachmentKind {
  if (mime.startsWith("audio/")) return isRecording ? "voice" : "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

export async function requestChatUpload(input: {
  conversationId: string;
  sizeBytes: number;
  /** Los primeros 16 bytes del archivo, en base64: alcanza para todas las firmas. */
  headBase64: string;
  declaredMime?: string;
  /** true cuando la subida viene del grabador del composer. */
  isRecording?: boolean;
}): Promise<ChatUploadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "No autorizado" };

  // Con el cliente del usuario: si la RLS no deja ver esta conversacion, no
  // hay ruta que firmar.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, workspace_id")
    .eq("id", input.conversationId)
    .maybeSingle();

  if (!conversation) return { ok: false, error: "No encontré esa conversación" };

  if (input.sizeBytes <= 0) return { ok: false, error: "El archivo está vacío" };
  if (input.sizeBytes > MAX_CHAT_UPLOAD_BYTES) {
    const mb = (input.sizeBytes / (1024 * 1024)).toFixed(1);
    return { ok: false, error: `El archivo pesa ${mb} MB y el máximo es 16 MB` };
  }

  const mime = sniffMime(new Uint8Array(Buffer.from(input.headBase64, "base64")));
  if (!mime) {
    return {
      ok: false,
      error: input.declaredMime
        ? `No puedo reconocer el archivo. Dice ser ${input.declaredMime}, pero su contenido no lo parece.`
        : "No reconozco ese tipo de archivo.",
    };
  }

  const kind = kindForUpload(mime, input.isRecording === true);
  const path = `${conversation.workspace_id}/${conversation.id}/out-${randomUUID()}.${extensionForMime(mime)}`;

  const service = await createServiceClient();
  const { data, error } = await service.storage.from(CHAT_MEDIA_BUCKET).createSignedUploadUrl(path);

  if (error || !data) {
    console.error("[chat-upload] no pude firmar la subida:", error?.message);
    return { ok: false, error: "No pude preparar la subida" };
  }

  return { ok: true, path, mime, kind, token: data.token };
}
