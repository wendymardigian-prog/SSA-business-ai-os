/**
 * A que link le corresponde una tarjeta en este mensaje. Puro: lo decide esto y la burbuja solo lo dibuja.
 *
 * Sin tarjeta: un envio fallido (en una fila vieja, el texto es el motivo del error), un email y un mensaje que ya trae
 * su tarjeta de adjunto (un reel compartido conserva la URL en el texto y saldria dos veces).
 */
import { parseAttachments, type AttachmentKind } from "@/lib/messages/attachments";
import { firstPreviewableLink } from "@/lib/messages/text-links";

const KINDS_WITH_OWN_CARD: readonly AttachmentKind[] = ["share", "link", "story_reply"];

export function messageLinkCardUrl(message: { text?: string | null; attachments?: unknown; email_from?: string | null }, options: { outbound: boolean; failed: boolean; channelShowsCards: boolean }): string | null {
  if (!options.channelShowsCards || options.failed || message.email_from) return null;
  const url = firstPreviewableLink(message.text, options.outbound);
  if (!url) return null;
  return parseAttachments(message.attachments).some((attachment) => KINDS_WITH_OWN_CARD.includes(attachment.kind)) ? null : url;
}
