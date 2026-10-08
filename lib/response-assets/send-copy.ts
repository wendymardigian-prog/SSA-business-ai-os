/**
 * Copia el archivo de un recurso de la banca (audio, video, imagen o archivo)
 * a la conversacion, y devuelve el path nuevo. Es OBLIGATORIA antes de mandar
 * cualquier recurso con archivo, por cualquier camino (la bandeja y el agente).
 *
 * Por que una copia y no mandar el path de la biblioteca directo:
 *
 *   1. `validateOutboundMedia` (app/api/v1/messages/route.ts) exige que el
 *      path arranque con `<workspaceId>/<conversationId>/`. Un path de
 *      biblioteca (`<ws>/library/<uuid>.<ext>`) no pasa ese prefijo, y el
 *      guard existe justamente para que nadie mande un archivo de otro lado
 *      adivinando una ruta.
 *   2. Si el path de biblioteca entrara en `messages.attachments`, el
 *      barrido de retencion del chat (`lib/chat-media/cleanup.ts`, 180 dias)
 *      lo borraria de Storage -- y con el, el recurso, para todos los envios
 *      futuros, no solo para ese mensaje.
 *   3. Con la copia, el archivo de la biblioteca lo referencia UNICAMENTE la
 *      fila del recurso. Eso permite que borrarlo o reemplazarlo pueda
 *      borrar su archivo en el momento (lib/response-assets/cleanup.ts), sin
 *      un barrido de huerfanos ni una columna nueva para marcarlos.
 *
 * La copia es server-side (`storage.copy`): no baja ni sube bytes por la red
 * del cliente que la pide.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { CHAT_MEDIA_BUCKET, extensionForMime, safeFilename } from "@/lib/chat-media/bucket";
import { FILE_KINDS, type AssetKind } from "./kind";

/** El kind del adjunto saliente (el que entiende sendChannelMessage) para cada tipo con archivo. */
export type OutboundAssetKind = "audio" | "video" | "image" | "document";

const OUTBOUND_KIND: Record<"audio" | "video" | "image" | "file", OutboundAssetKind> = {
  audio: "audio",
  video: "video",
  image: "image",
  file: "document",
};

export interface AssetChatCopy {
  /** El tipo del recurso. */
  assetKind: Extract<AssetKind, "audio" | "video" | "image" | "file">;
  /** El kind del adjunto que se manda (un archivo viaja como `document`). */
  kind: OutboundAssetKind;
  storagePath: string;
  mime: string;
  filename: string;
  durationSeconds: number | null;
  sizeBytes: number | null;
  /** El texto que lo acompaña por defecto (imagen, video, archivo). */
  caption: string | null;
}

export type CopyAssetToChatResult = { ok: true; copy: AssetChatCopy } | { ok: false; error: string };

/**
 * `supabase` tiene que ser el SERVICE CLIENT: el bucket `chat-media` no tiene
 * policies de escritura (igual que la subida firmada), asi que copiar un
 * objeto adentro es trabajo del servidor.
 */
export async function copyAssetToChat(
  supabase: SupabaseClient<Database>,
  args: { workspaceId: string; conversationId: string; assetId: string },
): Promise<CopyAssetToChatResult> {
  const { data: asset, error } = await supabase
    .from("response_assets")
    .select("kind, name, storage_path, mime_type, duration_seconds, size_bytes, caption")
    .eq("id", args.assetId)
    .eq("workspace_id", args.workspaceId)
    .in("kind", [...FILE_KINDS])
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !asset || !asset.storage_path || !asset.mime_type) {
    return { ok: false, error: "Ese recurso ya no está disponible" };
  }
  const assetKind = asset.kind as AssetChatCopy["assetKind"];

  const destination = `${args.workspaceId}/${args.conversationId}/library-${randomUUID()}.${extensionForMime(asset.mime_type)}`;

  const { error: copyError } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .copy(asset.storage_path, destination);

  if (copyError) {
    console.error("[response-assets] no pude copiar el recurso a la conversacion:", copyError.message);
    return { ok: false, error: "No pude preparar el recurso para mandarlo. Probá de nuevo." };
  }

  return {
    ok: true,
    copy: {
      assetKind,
      kind: OUTBOUND_KIND[assetKind],
      storagePath: destination,
      mime: asset.mime_type,
      // El nombre con el que lo recibe el contacto (un PDF se baja con este
      // nombre): el del recurso, saneado, con su extension.
      filename: `${safeFilename(asset.name, "recurso")}.${extensionForMime(asset.mime_type)}`,
      durationSeconds: assetKind === "audio" || assetKind === "video" ? asset.duration_seconds : null,
      sizeBytes: asset.size_bytes ?? null,
      caption: asset.caption ?? null,
    },
  };
}
