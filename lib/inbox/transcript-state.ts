/**
 * Los cuatro estados de la transcripcion en la burbuja (F13).
 *
 * La transcripcion se ve debajo del reproductor, no reemplazandolo: se puede
 * escuchar el audio Y leer lo que dice. Y tiene que decir en cual de los cuatro
 * estados esta, porque "no hay texto" puede significar cuatro cosas distintas y
 * cada una tiene una accion distinta.
 *
 * Modulo PURO.
 */

import { AUDIO_KINDS, parseAttachments } from "@/lib/messages/attachments";

export type TranscriptView =
  /** No hay audio: no se muestra nada. */
  | { state: "hidden" }
  /** Hay texto: se lee. */
  | { state: "ready"; text: string }
  /** Se esta transcribiendo. */
  | { state: "pending" }
  /** Fallo: se dice por que y se ofrece reintentar. */
  | { state: "failed"; error: string; canRetry: true }
  /** Nunca se intento: se ofrece transcribir. */
  | { state: "none" };

export interface TranscriptRow {
  transcript?: string | null;
  transcript_status?: string | null;
  transcript_error?: string | null;
  attachments?: unknown;
}

const DEFAULT_ERROR = "No pudimos transcribir el audio.";

/**
 * Que mostrar debajo del reproductor.
 *
 * Se decide por el ADJUNTO y no por las columnas: un mensaje de texto tiene
 * `transcript_status = 'none'` igual que una nota de voz sin transcribir, y
 * ofrecerle "Transcribir" a un mensaje escrito no tiene sentido.
 */
export function transcriptView(row: TranscriptRow | null | undefined): TranscriptView {
  if (!row) return { state: "hidden" };

  const items = parseAttachments(row.attachments);
  const hasAudio = items.some((item) => AUDIO_KINDS.includes(item.kind));
  if (!hasAudio) return { state: "hidden" };

  const text = row.transcript?.trim();
  if (row.transcript_status === "ready" && text) return { state: "ready", text };

  if (row.transcript_status === "pending") return { state: "pending" };

  if (row.transcript_status === "failed") {
    return { state: "failed", error: row.transcript_error?.trim() || DEFAULT_ERROR, canRetry: true };
  }

  // `ready` sin texto tambien cae aca: el estado dice una cosa y la columna otra,
  // y ofrecer transcribir de nuevo es mejor que mostrar un bloque vacio.
  return { state: "none" };
}

/**
 * Si tiene sentido pedir la transcripcion de este mensaje.
 *
 * Hace falta que el ARCHIVO este: un audio que no se pudo bajar, o que se purgo
 * por retencion, no se puede transcribir, y el boton fallaria siempre.
 */
export function canTranscribe(row: TranscriptRow | null | undefined): boolean {
  if (!row) return false;
  const items = parseAttachments(row.attachments);
  return items.some(
    (item) => AUDIO_KINDS.includes(item.kind) && item.status === "ready" && Boolean(item.storagePath),
  );
}
