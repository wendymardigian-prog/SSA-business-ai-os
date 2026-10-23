"use server";

import { getMemberAction, getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { CHAT_MEDIA_BUCKET, SIGNED_URL_SECONDS } from "@/lib/chat-media/bucket";
import { canReplyChannel } from "@/lib/inbox/channel-access";
import { stickerCapability } from "@/lib/channels/stickers";
import { parseAttachments } from "@/lib/messages/attachments";
import { STICKERS_PAGE_LIMIT, type StickerWithUrl } from "@/lib/stickers/format";
import { copyStickerToChat, saveStickerFromPath } from "@/lib/stickers/library";

/**
 * La biblioteca de stickers en la bandeja (00257). Verla, usarla, subir,
 * guardar y marcar favoritos: cualquier miembro (como la banca de recursos).
 * Borrar: `templates.manage`. Mandar: poder responder en esa cuenta, y solo
 * por un canal que admite stickers (lib/channels/stickers.ts).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function listStickers(): Promise<Result<{ stickers: StickerWithUrl[] }>> {
  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  const { data, error } = await ctx.supabase
    .from("stickers")
    .select("id, storage_path, is_animated, is_favorite, use_count, last_used_at, created_at")
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .limit(STICKERS_PAGE_LIMIT);
  if (error) {
    console.error("[stickers] no pude listar:", error.message);
    return { ok: false, error: "No pude cargar los stickers." };
  }
  const rows = data ?? [];
  // Firmadas con el cliente del usuario: la policy de chat-media mira que el
  // primer segmento sea su workspace.
  const { data: signed } = rows.length
    ? await ctx.supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrls(rows.map((r) => r.storage_path), SIGNED_URL_SECONDS)
    : { data: [] };
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return {
    ok: true,
    stickers: rows.map((r) => ({
      id: r.id,
      storagePath: r.storage_path,
      isAnimated: r.is_animated,
      isFavorite: r.is_favorite,
      useCount: r.use_count,
      lastUsedAt: r.last_used_at,
      createdAt: r.created_at,
      url: urlByPath.get(r.storage_path) ?? null,
    })),
  };
}

/** Copia el sticker a la conversacion y devuelve el path para mandarlo. */
export async function prepareStickerSend(input: { conversationId: string; stickerId: string }): Promise<Result<{ storagePath: string }>> {
  if (!UUID.test(input?.conversationId ?? "") || !UUID.test(input?.stickerId ?? "")) return { ok: false, error: "Pedido inválido." };
  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };

  const { data } = await ctx.supabase
    .from("conversations")
    .select("id, workspace_id, channel_id, channels(provider)")
    .eq("id", input.conversationId)
    .is("deleted_at", null)
    .maybeSingle();
  const conversation = data as { id: string; workspace_id: string; channel_id: string; channels?: { provider?: string } | null } | null;
  if (!conversation || conversation.workspace_id !== ctx.workspace.id) return { ok: false, error: "No encontré la conversación." };
  if (!canReplyChannel(ctx.permissions, conversation.channel_id)) return { ok: false, error: "Tu rol no puede responder por esta cuenta." };
  const capability = stickerCapability(conversation.channels?.provider);
  if (!capability.supported) return { ok: false, error: capability.reason };

  const service = await createServiceClient();
  const copy = await copyStickerToChat(service, {
    workspaceId: ctx.workspace.id,
    conversationId: conversation.id,
    stickerId: input.stickerId,
  });
  if (!copy.ok) return copy;
  return { ok: true, storagePath: copy.storagePath };
}

/** "Guardar sticker" en una burbuja: lo suma a la biblioteca. */
export async function saveStickerFromMessage(input: { messageId: string; storagePath: string }): Promise<Result> {
  if (!UUID.test(input?.messageId ?? "") || typeof input?.storagePath !== "string") return { ok: false, error: "Pedido inválido." };
  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };

  // Con el cliente del usuario: solo un mensaje que puede ver. Y el path tiene
  // que ser un sticker DE ESE mensaje: no se guarda cualquier archivo del bucket.
  const { data: message } = await ctx.supabase
    .from("messages")
    .select("id, workspace_id, attachments")
    .eq("id", input.messageId)
    .maybeSingle();
  if (!message || message.workspace_id !== ctx.workspace.id) return { ok: false, error: "No encontré ese mensaje." };
  const item = parseAttachments(message.attachments).find((a) => a.kind === "sticker" && a.storagePath === input.storagePath);
  if (!item?.storagePath) return { ok: false, error: "Ese mensaje no tiene ese sticker." };

  const service = await createServiceClient();
  const result = await saveStickerFromPath(service, { workspaceId: ctx.workspace.id, storagePath: item.storagePath, userId: ctx.user.id });
  return result.ok ? { ok: true } : result;
}

export async function setStickerFavorite(input: { stickerId: string; favorite: boolean }): Promise<Result> {
  if (!UUID.test(input?.stickerId ?? "") || typeof input?.favorite !== "boolean") return { ok: false, error: "Pedido inválido." };
  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  const service = await createServiceClient();
  const { data, error } = await service
    .from("stickers")
    .update({ is_favorite: input.favorite })
    .eq("id", input.stickerId)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "No pude cambiar el favorito." };
  return { ok: true };
}

/** Sacarlo de la biblioteca (borrado logico). Pide `templates.manage`, como la banca de recursos. */
export async function deleteSticker(input: { stickerId: string }): Promise<Result> {
  if (!UUID.test(input?.stickerId ?? "")) return { ok: false, error: "Pedido inválido." };
  const ctx = await getPermissionAction("templates.manage");
  if (!ctx) return { ok: false, error: "Tu rol no puede sacar stickers de la biblioteca." };
  const service = await createServiceClient();
  const { data, error } = await service
    .from("stickers")
    .update({ deleted_at: new Date().toISOString(), is_favorite: false })
    .eq("id", input.stickerId)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "No pude sacar el sticker." };
  return { ok: true };
}
