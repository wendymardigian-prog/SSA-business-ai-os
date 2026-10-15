/**
 * Herencia de pieza en los DMs que responden a una automatizacion (Extra I, F35).
 *
 * Una persona comenta "info" en un Reel, una automatizacion le manda un DM con la pieza en su contexto
 * (`origin_context.content`, via "flow") y la persona CONTESTA ese DM. Esa respuesta no trae ningun origen propio
 * —no es una respuesta a historia ni viene de un anuncio—, pero sigue siendo gente que llego por esa pieza: hereda.
 *
 * Reglas (`inheritContent`):
 *   1. el entrante no trae origen propio: ni anuncio (`ad`), ni respuesta a historia, ni mencion, ni un `content`
 *      ya puesto. Si trae anuncio, GANA el anuncio y no se hereda nada;
 *   2. el ultimo saliente trae `origin_context.content` con al menos una pieza o publicacion;
 *   3. ese saliente es de hace `days` dias o menos (el borde cuenta: con 7, "hace 7 dias" hereda y "hace 8" no).
 *
 * Un toque por mensaje de automatizacion respondido, no uno por respuesta: `inheritDedupeKey`.
 *
 * Modulo PURO y sin dependencias. NUNCA lanza: lo que se pueda leer mal es "no hereda".
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Como llego la pieza al mensaje (`origin_context.content.via`). */
export type ContentVia = "flow" | "automation_reply";

/** `origin_context.content`, ya leido. */
export interface ContentOrigin {
  social_post_id: string | null;
  content_post_id: string | null;
  via: string | null;
  flow_id: string | null;
  outbound_message_id: string | null;
}

/** Lo que se necesita del ultimo mensaje saliente de la conversacion con pieza. */
export interface OutboundForInherit {
  /** `messages.id` del saliente. */
  id: string;
  /** Cuando se envio (`messages.created_at`). */
  created_at: string | Date;
  /** `messages.origin_context`: de ahi sale `content`. */
  origin_context?: unknown;
}

/** Lo que se necesita del mensaje entrante. */
export interface InboundForInherit {
  origin_context?: unknown;
}

export interface InheritedContent {
  content_post_id: string | null;
  social_post_id: string | null;
  via: "automation_reply";
  outbound_message_id: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clean = (value: unknown, max = 200): string | null => {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Lee `origin_context.content`. Null si no esta o no trae ni pieza ni publicacion (un `content` vacio no sirve
 * de nada y no debe contar como "tiene origen"). Tambien lo usa `messageOrigin`.
 */
export function readContentOrigin(originContext: unknown): ContentOrigin | null {
  if (!isRecord(originContext)) return null;
  const content = originContext.content;
  if (!isRecord(content)) return null;

  const social = clean(content.social_post_id);
  const piece = clean(content.content_post_id);
  if (!social && !piece) return null;

  return {
    social_post_id: social,
    content_post_id: piece,
    via: clean(content.via, 50),
    flow_id: clean(content.flow_id),
    outbound_message_id: clean(content.outbound_message_id),
  };
}

/** ¿El mensaje entrante trae un origen propio (anuncio, historia, mencion o una pieza ya puesta)? */
export function hasOwnOrigin(originContext: unknown): boolean {
  if (!isRecord(originContext)) return false;
  if (isRecord(originContext.ad)) return true;
  if (isRecord(originContext.story_reply)) return true;
  if (originContext.story_mention === true) return true;
  // Una pieza ya puesta (por ejemplo una herencia anterior): no se pisa ni se vuelve a heredar.
  if (isRecord(originContext.content)) return true;
  return false;
}

/**
 * La pieza que hereda el mensaje entrante, o null si no hereda.
 *
 * `now` y `days` los pasa quien llama (`days` sale de `attribution_settings.content_inherit_days`).
 */
export function inheritContent(
  lastOutbound: OutboundForInherit | null | undefined,
  inbound: InboundForInherit | null | undefined,
  now: Date,
  days: number,
): InheritedContent | null {
  try {
    if (!lastOutbound || !inbound) return null;
    if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return null;

    // 1) Con origen propio no se hereda; si es un anuncio, gana el anuncio.
    if (hasOwnOrigin(inbound.origin_context)) return null;

    // 2) El saliente tiene que traer una pieza.
    const content = readContentOrigin(lastOutbound.origin_context);
    const outboundId = clean(lastOutbound.id);
    if (!content || !outboundId) return null;

    // 3) Y ser reciente.
    const sentAt = lastOutbound.created_at instanceof Date ? lastOutbound.created_at : new Date(lastOutbound.created_at);
    if (Number.isNaN(sentAt.getTime()) || Number.isNaN(now.getTime())) return null;
    if (now.getTime() - sentAt.getTime() > days * DAY_MS) return null;

    return {
      content_post_id: content.content_post_id,
      social_post_id: content.social_post_id,
      via: "automation_reply",
      outbound_message_id: outboundId,
    };
  } catch {
    return null;
  }
}

/** La clave del toque de una respuesta heredada: una por mensaje de automatizacion, no por cada respuesta. */
export function inheritDedupeKey(outboundMessageId: string): string {
  return `content-reply:${outboundMessageId}`;
}
