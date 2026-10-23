/**
 * La biblioteca de stickers (00257), del lado del servidor.
 *
 * Tres maneras de sumar uno, una sola funcion que escribe (`upsertSticker`):
 *  - `collectSentSticker`: un sticker que se mando (desde el celular o desde
 *    aca) y ya esta en `chat-media`. Lo llama el webhook; NUNCA lanza.
 *  - `saveStickerFromMessage` (accion): uno recibido, con el boton "Guardar".
 *  - la subida (`/api/v1/stickers`): una imagen o GIF ya normalizado.
 *
 * Todas reciben el cliente de SERVICIO: el bucket y la tabla no tienen
 * policies de escritura. Quien llama ya chequeo el permiso y saca el workspace
 * de la sesion (o del canal, en el webhook).
 */

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { CHAT_MEDIA_BUCKET } from "@/lib/chat-media/bucket";
import { isAnimatedWebp, isWebp, STICKER_MIME, stickerLibraryPath } from "./format";

type Db = SupabaseClient<Database>;
type Source = "uploaded" | "sent" | "saved";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type UpsertStickerResult = { ok: true; id: string; created: boolean } | { ok: false; error: string };

/**
 * Guarda (o reusa) un sticker por su contenido. Si ya existe: un envio suma
 * un uso; guardarlo o subirlo a mano lo revive si estaba borrado. Un envio NO
 * revive uno borrado (alguien lo saco a proposito).
 */
export async function upsertSticker(
  service: Db,
  args: { workspaceId: string; bytes: Uint8Array; source: Source; createdBy: string | null; animated?: boolean },
): Promise<UpsertStickerResult> {
  if (!isWebp(args.bytes)) return { ok: false, error: "El sticker no es un webp." };
  const sha = sha256Hex(args.bytes);
  const now = new Date().toISOString();

  const { data: existing } = await service
    .from("stickers")
    .select("id, deleted_at, use_count")
    .eq("workspace_id", args.workspaceId)
    .eq("sha256", sha)
    .maybeSingle();

  if (existing) {
    if (existing.deleted_at && args.source === "sent") return { ok: true, id: existing.id, created: false };
    const patch =
      args.source === "sent"
        ? { use_count: existing.use_count + 1, last_used_at: now }
        : { deleted_at: null, ...(existing.deleted_at ? { source: args.source } : {}) };
    await service.from("stickers").update(patch).eq("id", existing.id);
    return { ok: true, id: existing.id, created: false };
  }

  const path = stickerLibraryPath(args.workspaceId, sha);
  const { error: uploadError } = await service.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(path, args.bytes, { contentType: STICKER_MIME, upsert: true });
  if (uploadError) {
    console.error("[stickers] no pude guardar el archivo:", uploadError.message);
    return { ok: false, error: "No pude guardar el sticker. Probá de nuevo." };
  }

  const { data: created, error } = await service
    .from("stickers")
    .insert({
      workspace_id: args.workspaceId,
      storage_path: path,
      sha256: sha,
      is_animated: args.animated ?? isAnimatedWebp(args.bytes),
      size_bytes: args.bytes.byteLength,
      source: args.source,
      created_by: args.createdBy,
      ...(args.source === "sent" ? { use_count: 1, last_used_at: now } : {}),
    })
    .select("id")
    .single();
  if (error || !created) {
    // Dos llegadas del mismo sticker a la vez: el indice unico gana, y es el mismo.
    if (error?.code === "23505") {
      const { data: again } = await service.from("stickers").select("id").eq("workspace_id", args.workspaceId).eq("sha256", sha).maybeSingle();
      if (again) return { ok: true, id: again.id, created: false };
    }
    console.error("[stickers] no pude registrar el sticker:", error?.message);
    return { ok: false, error: "No pude guardar el sticker. Probá de nuevo." };
  }
  return { ok: true, id: created.id, created: true };
}

/** Lee un archivo de `chat-media` (un sticker que ya esta en una conversacion). */
async function readChatMedia(service: Db, storagePath: string): Promise<Uint8Array | null> {
  const { data, error } = await service.storage.from(CHAT_MEDIA_BUCKET).download(storagePath);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** Un sticker que se mando (desde el celular o desde aca). Nunca lanza. */
export async function collectSentSticker(service: Db, args: { workspaceId: string; storagePath: string }): Promise<void> {
  try {
    const bytes = await readChatMedia(service, args.storagePath);
    if (!bytes) return;
    const result = await upsertSticker(service, { workspaceId: args.workspaceId, bytes, source: "sent", createdBy: null });
    if (!result.ok) console.error("[stickers] no pude sumar el sticker enviado:", result.error);
  } catch (err) {
    console.error("[stickers] no pude sumar el sticker enviado:", err instanceof Error ? err.message : String(err));
  }
}

/** Guarda en la biblioteca un sticker que esta en un mensaje. */
export async function saveStickerFromPath(
  service: Db,
  args: { workspaceId: string; storagePath: string; userId: string },
): Promise<UpsertStickerResult> {
  const bytes = await readChatMedia(service, args.storagePath);
  if (!bytes) return { ok: false, error: "Ese sticker ya no está disponible." };
  return upsertSticker(service, { workspaceId: args.workspaceId, bytes, source: "saved", createdBy: args.userId });
}

/**
 * Copia un sticker de la biblioteca a la conversacion, para mandarlo. Mismo
 * criterio que `copyAssetToChat`: el mensaje referencia la COPIA, asi la
 * retencion del chat nunca se lleva el de la biblioteca.
 */
export async function copyStickerToChat(
  service: Db,
  args: { workspaceId: string; conversationId: string; stickerId: string },
): Promise<{ ok: true; storagePath: string } | { ok: false; error: string }> {
  const { data: sticker } = await service
    .from("stickers")
    .select("storage_path")
    .eq("id", args.stickerId)
    .eq("workspace_id", args.workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!sticker) return { ok: false, error: "Ese sticker ya no está en la biblioteca." };

  const destination = `${args.workspaceId}/${args.conversationId}/sticker-${randomUUID()}.webp`;
  const { error } = await service.storage.from(CHAT_MEDIA_BUCKET).copy(sticker.storage_path, destination);
  if (error) {
    console.error("[stickers] no pude copiar el sticker a la conversacion:", error.message);
    return { ok: false, error: "No pude preparar el sticker. Probá de nuevo." };
  }
  return { ok: true, storagePath: destination };
}

/** Un uso mas (despues de mandarlo). Nunca frena un envio. */
export async function touchSticker(service: Db, args: { workspaceId: string; stickerId: string }): Promise<void> {
  try {
    const { data } = await service
      .from("stickers")
      .select("use_count")
      .eq("id", args.stickerId)
      .eq("workspace_id", args.workspaceId)
      .maybeSingle();
    if (!data) return;
    await service
      .from("stickers")
      .update({ use_count: data.use_count + 1, last_used_at: new Date().toISOString() })
      .eq("id", args.stickerId);
  } catch (err) {
    console.error("[stickers] no pude contar el uso:", err instanceof Error ? err.message : String(err));
  }
}
