/**
 * Como se abre un recurso de la banca para revisarlo antes de mandarlo (F9).
 *
 * Puro. La regla que sostiene esto: **no se construye un visor nuevo.** Un
 * recurso con archivo se convierte en el mismo `ChatAttachment` que pinta la
 * burbuja de la bandeja, y lo dibuja `components/inbox/media-attachment.tsx`
 * tal cual: firma recien al apretar play o al abrir (la URL es la ruta propia
 * `/api/v1/chat-media`, que firma con el cliente del usuario), y distingue lo
 * que el navegador puede mostrar de lo que tiene que bajar.
 *
 * Un path de biblioteca (`<ws>/library/<id>.<ext>`) pasa por esa ruta igual
 * que uno de conversacion: la policy del bucket mira solo el primer segmento,
 * que en los dos casos es el workspace.
 */

import { emptyAttachment, type AttachmentKind, type ChatAttachment } from "@/lib/messages/attachments";
import { chatMediaDownloadUrl, chatMediaUrl, extensionForMime, safeFilename } from "@/lib/chat-media/bucket";
import type { AssetKind } from "./kind";
import type { BankAsset } from "./list";

/** El tipo de adjunto de la bandeja que le corresponde a cada tipo con archivo. */
export const ATTACHMENT_KIND: Record<Exclude<AssetKind, "text" | "link">, AttachmentKind> = {
  audio: "audio",
  video: "video",
  image: "image",
  file: "document",
};

/** El nombre con el que se baja o se manda: el del recurso, con su extension. */
export function assetFilename(asset: Pick<BankAsset, "name" | "mimeType">): string {
  return `${safeFilename(asset.name, "recurso")}.${extensionForMime(asset.mimeType)}`;
}

/** El adjunto para `MediaAttachment`, o null si el recurso no tiene archivo. */
export function assetAttachment(
  asset: Pick<BankAsset, "kind" | "name" | "storagePath" | "mimeType" | "sizeBytes" | "durationSeconds">,
): ChatAttachment | null {
  if (asset.kind === "text" || asset.kind === "link" || !asset.storagePath) return null;
  return emptyAttachment(ATTACHMENT_KIND[asset.kind], {
    storagePath: asset.storagePath,
    mime: asset.mimeType,
    filename: assetFilename(asset),
    sizeBytes: asset.sizeBytes,
    durationSeconds: asset.durationSeconds,
    status: "ready",
  });
}

/** Lo que el navegador sabe mostrar en una pestaña; lo demas se baja. */
function opensInline(mime: string | null): boolean {
  const clean = (mime ?? "").split(";")[0].trim().toLowerCase();
  return clean === "application/pdf" || clean.startsWith("image/") || clean.startsWith("video/") || clean.startsWith("audio/");
}

/**
 * El "Abrir" / "Ver en grande": un PDF, una imagen o un video se abren en una
 * pestaña (el visor del navegador); un Word o un Excel, que el navegador no
 * sabe mostrar, se bajan con su nombre.
 */
export function assetOpenUrl(asset: Pick<BankAsset, "kind" | "name" | "storagePath" | "mimeType" | "url">): string | null {
  if (asset.kind === "link") return asset.url;
  if (asset.kind === "text" || !asset.storagePath) return null;
  return opensInline(asset.mimeType)
    ? chatMediaUrl(asset.storagePath)
    : chatMediaDownloadUrl(asset.storagePath, assetFilename(asset));
}

/** La miniatura de la lista: la imagen misma, o la del video. Se carga lazy. */
export function assetThumbUrl(asset: Pick<BankAsset, "kind" | "storagePath" | "previewPath">): string | null {
  if (asset.kind === "image" && asset.storagePath) return chatMediaUrl(asset.storagePath);
  if (asset.kind === "video" && asset.previewPath) return chatMediaUrl(asset.previewPath);
  return null;
}
