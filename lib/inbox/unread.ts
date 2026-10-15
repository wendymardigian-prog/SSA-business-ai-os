/**
 * Cuando una respuesta nuestra apaga el "no leido" de una conversacion.
 *
 * El contador (`conversations.unread_count`) sube con cada mensaje del lead y
 * se apaga cuando alguien abre la conversacion en la bandeja. Faltaba un caso:
 * las respuestas que salen FUERA de la app (ManyChat, Meta Business Suite, la
 * app de Instagram, el celular de WhatsApp). Entran como eco y se guardan, pero
 * nadie abre la conversacion en la app, asi que el lead quedaba como "no leido"
 * aunque ya estuviera respondido (14/10/2026: 457 de 570 conversaciones).
 *
 * La regla, en palabras de quien la pidio: si lo ultimo que se dijo es mio, no
 * esta sin leer, venga de donde venga. Pero una automatizacion DE ESTA APP
 * (flow, secuencia, difusion, agente) no cuenta como que yo respondi: si el
 * lead escribio y despues solo contesto el sistema, nadie lo leyo todavia.
 *
 * Modulo PURO.
 */

import type { MessageOrigin } from "@/lib/types/database";

/**
 * true si un saliente cuenta como "yo respondi": lo escribio una persona en la
 * app, o salio de afuera de la app (`external`). Un mensaje del agente que una
 * persona aprobo y envio (`sentByUserId`) tambien es una respuesta humana.
 */
export function outboundCountsAsAnswered(
  origin: MessageOrigin | null | undefined,
  sentByUserId: string | null | undefined,
): boolean {
  if (sentByUserId) return true;
  return origin === "user" || origin === "external";
}

/**
 * true si el saliente es posterior (o simultaneo) a todo lo que escribio el
 * lead: solo entonces apaga el no leido. Un eco que llega tarde, de antes de un
 * mensaje nuevo del lead, no puede tapar ese mensaje.
 */
export function isNewerThanLastInbound(outboundAt: string, lastInboundAt: string | null): boolean {
  if (!lastInboundAt) return true;
  const out = Date.parse(outboundAt);
  const inbound = Date.parse(lastInboundAt);
  if (Number.isNaN(out) || Number.isNaN(inbound)) return false;
  return out >= inbound;
}
