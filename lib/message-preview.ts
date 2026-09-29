import { attachmentsLabel, parseAttachments } from "@/lib/messages/attachments";

const PREVIEW_LENGTH = 100;

/**
 * Truncates a message for `conversations.last_message_preview`.
 *
 * Slices by code point, never by UTF-16 code unit: a plain `slice` cuts an
 * emoji's surrogate pair in half whenever one straddles the limit, and
 * PostgREST rejects the resulting lone surrogate with `PGRST102 Empty or
 * invalid json`, which silently dropped whole conversations during inbox
 * backfill.
 */
export function messagePreview(text: string | null | undefined): string {
  return Array.from(text ?? "").slice(0, PREVIEW_LENGTH).join("");
}

/**
 * El preview de la lista de conversaciones (F15).
 *
 * Antes era solo el texto, asi que un mensaje de Instagram sin texto —una nota
 * de voz, una foto— dejaba la fila en blanco: en la lista no se veia que habia
 * pasado algo. El orden es el que espera quien mira:
 *
 *   1. El texto, si hay. Es lo que la persona escribio.
 *   2. La transcripcion, recortada. Dice mas que "Nota de voz".
 *   3. La etiqueta del adjunto. "🎤 Nota de voz" es mejor que nada.
 *   4. Vacio, si de verdad no hay nada.
 */
export function previewForMessage(message: {
  text?: string | null;
  transcript?: string | null;
  attachments?: unknown;
}): string {
  const text = messagePreview(message.text);
  if (text.length > 0) return text;

  const transcript = messagePreview(message.transcript);
  if (transcript.length > 0) return transcript;

  return attachmentsLabel(parseAttachments(message.attachments)) ?? "";
}
