/**
 * La compuerta de `no_hace_falta_responder` (00259): cuando el agente puede
 * dejar de responder sin que eso sea un riesgo.
 *
 * El modelo decide si el mensaje cierra la charla; esto solo descarta los casos
 * en que equivocarse deja a un lead sin respuesta:
 *
 *   - Un "?" o "¿" en cualquier mensaje de la tanda (o en su transcripcion o
 *     descripcion): pide algo.
 *   - Un adjunto que no sea sticker ni GIF: un audio, una foto, un video, un
 *     documento, una ubicacion piden que alguien los mire.
 *   - Nuestra ultima respuesta fue una pregunta o una promesa ("dame un
 *     momento", "ya te lo paso"): el lead sigue esperando algo (misma regla que
 *     la base, `leavesSomethingPending`).
 *
 * Modulo PURO.
 */

import { parseAttachments } from "@/lib/messages/attachments";
import { asksSomething, CLOSURE_ATTACHMENT_KINDS, leavesSomethingPending } from "@/lib/messages/closure";

export interface SkipCandidate {
  text: string | null;
  transcript?: string | null;
  media_description?: string | null;
  attachments?: unknown;
}

export function canSkipReply(burst: readonly SkipCandidate[], lastReplyText: string | null = null): boolean {
  if (burst.length === 0) return false;
  if (leavesSomethingPending(lastReplyText)) return false;
  return burst.every((m) => {
    if (asksSomething(m.text) || asksSomething(m.transcript) || asksSomething(m.media_description)) return false;
    return parseAttachments(m.attachments).every((a) => CLOSURE_ATTACHMENT_KINDS.includes(a.kind));
  });
}
