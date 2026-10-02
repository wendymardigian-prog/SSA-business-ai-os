/**
 * Copia el archivo de audio de un recurso de la banca a la conversacion, y
 * devuelve el path nuevo.
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
import { CHAT_MEDIA_BUCKET, extensionForMime } from "@/lib/chat-media/bucket";

export interface AssetChatCopy {
  storagePath: string;
  mime: string;
  filename: string;
  durationSeconds: number | null;
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
    .select("name, storage_path, mime_type, duration_seconds")
    .eq("id", args.assetId)
    .eq("workspace_id", args.workspaceId)
    .eq("kind", "audio")
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !asset || !asset.storage_path || !asset.mime_type) {
    return { ok: false, error: "Ese audio ya no está disponible" };
  }

  const destination = `${args.workspaceId}/${args.conversationId}/library-${randomUUID()}.${extensionForMime(asset.mime_type)}`;

  const { error: copyError } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .copy(asset.storage_path, destination);

  if (copyError) {
    console.error("[response-assets] no pude copiar el audio a la conversacion:", copyError.message);
    return { ok: false, error: "No pude preparar el audio para mandarlo" };
  }

  return {
    ok: true,
    copy: {
      storagePath: destination,
      mime: asset.mime_type,
      filename: `${asset.name}.${extensionForMime(asset.mime_type)}`,
      durationSeconds: asset.duration_seconds,
    },
  };
}
