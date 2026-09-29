/**
 * Leer un mensaje de WhatsApp como lo entrega Evolution API (Baileys).
 *
 * WhatsApp no manda "el texto" en un solo lugar: depende del tipo de mensaje.
 * Un texto suelto viene en `conversation`, uno con vista previa de link en
 * `extendedTextMessage.text`, y el pie de una foto o un video en el `caption`
 * de su propio objeto. Si no se miran todos, media conversacion entra vacia.
 */

import { attachmentLabel, type AttachmentKind } from "@/lib/messages/attachments";

/**
 * Que tipo de adjunto es cada nodo de WhatsApp.
 *
 * Las etiquetas ya no viven aca: salen de `attachmentLabel` (F1), que es la
 * unica fuente y la misma que usa la bandeja. Antes estaban duplicadas y
 * decian otra cosa que la burbuja ("🎥 Video" contra "🎬 Video"), asi que el
 * preview de la lista y el mensaje abierto no coincidian.
 */
const ATTACHMENT_KINDS: Record<string, AttachmentKind> = {
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  stickerMessage: "sticker",
  locationMessage: "location",
  contactMessage: "contact",
  pollCreationMessage: "poll",
  pollCreationMessageV2: "poll",
  pollCreationMessageV3: "poll",
};

/** Rutas donde WhatsApp puede dejar el texto, en orden de preferencia. */
const TEXT_PATHS: string[][] = [
  ["conversation"],
  ["extendedTextMessage", "text"],
  ["imageMessage", "caption"],
  ["videoMessage", "caption"],
  ["documentMessage", "caption"],
  ["buttonsResponseMessage", "selectedDisplayText"],
  ["listResponseMessage", "title"],
];

function pick(source: Record<string, unknown>, path: string[]): string | null {
  let current: unknown = source;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.length > 0 ? current : null;
}

/** El texto del mensaje, o null si es puro adjunto. */
export function extractText(message: Record<string, unknown> | undefined | null): string | null {
  if (!message) return null;
  for (const path of TEXT_PATHS) {
    const found = pick(message, path);
    if (found) return found;
  }
  return null;
}

/**
 * Etiqueta legible para un mensaje sin texto, para que el preview de la bandeja
 * no quede en blanco. null si no sabemos que es.
 */
export function describeAttachment(messageType: string | undefined | null): string | null {
  if (!messageType) return null;
  const kind = ATTACHMENT_KINDS[messageType];
  return kind ? attachmentLabel(kind) : null;
}

/**
 * Momento del mensaje. Evolution manda segundos (a veces como string). Si viene
 * algo que no sirve se usa el ahora: es preferible un timestamp aproximado a una
 * conversacion que se ordena mal en la bandeja.
 */
export function messageTimestamp(raw: number | string | undefined | null): string {
  const seconds = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1000).toISOString();
  }
  return new Date().toISOString();
}
