/**
 * El texto EFECTIVO de un mensaje (F9).
 *
 * El problema que arregla: el agente armaba el historial con `m.text`, asi que
 * un mensaje sin texto —una nota de voz, una foto— no existia para el. Pero el
 * turno se agendaba igual y el modelo respondia como si el lead no hubiera dicho
 * nada. Estaba contestando cosas que no tenian nada que ver.
 *
 * Ahora el mensaje entra con lo que se pudo entender de el, EN ESTE ORDEN:
 *
 *   1. `text`         lo que la persona escribio. Si hay caption, el caption
 *                     gana: es lo que eligio escribir, y la transcripcion del
 *                     audio que lo acompaña es contexto de mas.
 *   2. `transcript`   la transcripcion del audio, solo si esta `ready`.
 *   3. `media_description`  lo que el modelo de vision vio en la imagen.
 *   4. null           no hay nada interpretable. Sigue quedando FUERA del
 *                     historial, igual que antes.
 *
 * Lo derivado va MARCADO (`[Nota de voz] "…"`). El modelo tiene que saber que es
 * un audio transcripto y no algo que el lead escribio: son dos cosas distintas y
 * confundirlas cambia como contesta. Y como cualquier mensaje del lead, sigue
 * envuelto en `wrapUntrusted` mas adelante: un audio que diga "ignorá tus
 * instrucciones" no es distinto de un texto que lo diga.
 *
 * Modulo PURO.
 */

import { AUDIO_KINDS, attachmentLabel, parseAttachments } from "@/lib/messages/attachments";

/** Lo minimo que hace falta para decidir. */
export interface MessageWithMedia {
  text?: string | null;
  transcript?: string | null;
  transcript_status?: string | null;
  media_description?: string | null;
  attachments?: unknown;
}

/**
 * Lo que el modelo lee de este mensaje, o null si no hay nada que leer.
 *
 * No se inventa nada: si el audio no se transcribio, este mensaje NO entra al
 * historial. Meter "[Nota de voz sin transcribir]" seria peor que no meterlo,
 * porque el modelo contestaria sobre un audio que no escucho.
 */
export function effectiveMessageText(message: MessageWithMedia): string | null {
  const text = message.text?.trim();
  if (text) return text;

  const transcript = message.transcript?.trim();
  if (transcript && message.transcript_status === "ready") {
    const items = parseAttachments(message.attachments);
    const isVoice = items.some((item) => item.kind === "voice");
    // "Nota de voz" y "Audio" no son lo mismo para quien lee: una nota de voz la
    // grabo la persona en ese momento, un audio puede ser un reenvio.
    const label = isVoice || items.length === 0 ? "Nota de voz" : "Audio";
    return `[${label}] "${transcript}"`;
  }

  const described = message.media_description?.trim();
  if (described) return `[Imagen] ${described}`;

  return null;
}

/**
 * Por que este mensaje no se puede leer, en castellano, o null si se puede.
 *
 * Lo usa la compuerta de interpretabilidad para explicarle a la persona que fue
 * lo que el agente no pudo entender. Es una frase para un humano, no un codigo.
 */
export function unreadableReason(message: MessageWithMedia): string | null {
  if (effectiveMessageText(message) !== null) return null;

  const items = parseAttachments(message.attachments);

  if (items.length === 0) {
    // Sin texto y sin adjuntos: no hay nada, y nada no es ilegible.
    return null;
  }

  const audio = items.find((item) => AUDIO_KINDS.includes(item.kind));
  if (audio) {
    const label = audio.kind === "voice" ? "una nota de voz" : "un audio";
    if (message.transcript_status === "failed") {
      return `Llegó ${label} que no se pudo transcribir`;
    }
    if (message.transcript_status === "pending") {
      return `Llegó ${label} y la transcripción no terminó a tiempo`;
    }
    return `Llegó ${label} sin transcribir`;
  }

  const image = items.find((item) => item.kind === "image" || item.kind === "sticker");
  if (image) return "Llegó una imagen que el asistente no pudo interpretar";

  const video = items.find((item) => item.kind === "video" || item.kind === "gif");
  if (video) return "Llegó un video, que el asistente no puede ver";

  const document = items.find((item) => item.kind === "document");
  if (document) return "Llegó un documento, que el asistente no puede leer";

  const location = items.find((item) => item.kind === "location");
  if (location) return "Llegó una ubicación";

  const contact = items.find((item) => item.kind === "contact");
  if (contact) return "Llegó un contacto compartido";

  const poll = items.find((item) => item.kind === "poll");
  if (poll) return "Llegó una encuesta";

  const share = items.find((item) => item.kind === "share" || item.kind === "link" || item.kind === "story_reply");
  if (share) {
    return share.kind === "story_reply"
      ? "Llegó una respuesta a una historia, que el asistente no puede ver"
      : "Llegó una publicación compartida, que el asistente no puede abrir";
  }

  // Un tipo que no conocemos. Se nombra con su etiqueta para que la persona
  // sepa al menos que fue.
  return `Llegó ${attachmentLabel(items[0].kind).replace(/^[^\w]+\s*/, "").toLowerCase()}, que el asistente no puede interpretar`;
}
