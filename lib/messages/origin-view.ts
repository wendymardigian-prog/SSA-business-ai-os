/**
 * Como se LEE el origen de un mensaje entrante (Extra I, F36 y F44).
 *
 * `messages.origin_context` (00189) guarda, con una lista blanca, de donde vino un mensaje: el anuncio que abrio la
 * conversacion, la respuesta a una historia, la mencion en una historia y —desde el Extra I— la PIEZA de contenido
 * (`content`, F35: el DM contesta a una automatizacion que salio de un comentario). Este modulo lo traduce a lo que
 * la bandeja (chip "Vino de…") y la linea de tiempo necesitan. La forma del contexto la define `origin-context.ts`;
 * acá solo se LEE.
 *
 * PURO y NUNCA lanza: el contexto viene de un jsonb que pudo escribir cualquier version del codigo.
 */
import { readContentOrigin } from "@/lib/attribution/inherit";

/** De que tipo de origen se trata. */
export type MessageOriginKind = "ad" | "content" | "story" | "mention";

export interface MessageOrigin {
  /** Null si el mensaje no trae ningun origen. */
  kind: MessageOriginKind | null;
  /** La pieza de contenido (`content_posts.id`), si el origen la trae. */
  contentPostId: string | null;
  /** La publicacion (`social_posts.id`), si el origen la trae. */
  socialPostId: string | null;
  /** El anuncio de Meta (`ad_id`), si es un anuncio. */
  adId: string | null;
  /**
   * El origen en palabras, sin el "Vino de:" ni el nombre de la pieza (eso lo pone la pantalla, que tiene el
   * titulo): "Anuncio «Video testimonio»", "Respuesta a tu historia", "Te mencionó en una historia", "Contenido".
   */
  label: string;
}

const NONE: MessageOrigin = { kind: null, contentPostId: null, socialPostId: null, adId: null, label: "" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clean = (value: unknown, max = 200): string | null => {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
};

/**
 * El origen de un mensaje. Si traen mas de uno, manda el mas especifico: anuncio > respuesta a una historia >
 * mencion > contenido (un anuncio gana a la pieza, igual que en la herencia de F35).
 */
export function messageOrigin(originContext: unknown): MessageOrigin {
  try {
    if (!isRecord(originContext)) return { ...NONE };

    if (isRecord(originContext.ad)) {
      const adId = clean(originContext.ad.ad_id);
      const title = clean(originContext.ad.title, 120);
      return { kind: "ad", contentPostId: null, socialPostId: null, adId, label: title ? `Anuncio «${title}»` : "Anuncio" };
    }

    if (isRecord(originContext.story_reply)) {
      // Desde F33, si la historia es nuestra, el contexto trae tambien la publicacion y la pieza.
      return {
        kind: "story",
        contentPostId: clean(originContext.story_reply.content_post_id),
        socialPostId: clean(originContext.story_reply.social_post_id),
        adId: null,
        label: "Respuesta a tu historia",
      };
    }

    if (originContext.story_mention === true) {
      return { kind: "mention", contentPostId: null, socialPostId: null, adId: null, label: "Te mencionó en una historia" };
    }

    const content = readContentOrigin(originContext);
    if (content) {
      const title = isRecord(originContext.content) ? clean(originContext.content.title, 120) : null;
      return {
        kind: "content",
        contentPostId: content.content_post_id,
        socialPostId: content.social_post_id,
        adId: null,
        label: title ? `Contenido «${title}»` : "Contenido",
      };
    }

    return { ...NONE };
  } catch {
    return { ...NONE };
  }
}

/** Un mensaje de la bandeja, en lo que hace falta para decidir los chips. */
export interface ChipMessage {
  id: string;
  direction: "inbound" | "outbound";
  origin_context?: unknown;
}

export interface OriginChip {
  /** El mensaje ENTRANTE debajo del cual va el chip. */
  messageId: string;
  origin: MessageOrigin & { kind: MessageOriginKind };
}

/** Dos origenes son "el mismo" si son del mismo tipo y apuntan a lo mismo (otra pieza u otro anuncio = otro origen). */
function originKey(origin: MessageOrigin): string {
  return `${origin.kind}:${origin.contentPostId ?? origin.socialPostId ?? origin.adId ?? ""}`;
}

/**
 * Los chips "Vino de…" de un hilo: SOLO en el primer mensaje entrante de cada tramo con el mismo origen.
 *
 * `messages` va en el orden en que se dibuja el hilo (del mas viejo al mas nuevo). Reglas:
 *   - solo los mensajes entrantes con origen llevan chip;
 *   - los salientes no cuentan ni cortan el tramo (que le contestemos no hace que la persona "vuelva a venir"
 *     de la misma pieza);
 *   - un entrante SIN origen corta el tramo: si despues viene otro con el origen de antes, es una vuelta nueva y
 *     lleva su chip;
 *   - un origen distinto (otra pieza, otro anuncio, otro tipo) abre un tramo nuevo.
 *
 * Tres mensajes de la misma pieza y uno de otra: dos chips.
 */
export function originChipsFor(messages: readonly ChipMessage[]): OriginChip[] {
  const chips: OriginChip[] = [];
  try {
    let current: string | null = null;
    for (const message of messages) {
      if (message.direction !== "inbound") continue;

      const origin = messageOrigin(message.origin_context);
      if (origin.kind === null) {
        current = null;
        continue;
      }

      const key = originKey(origin);
      if (key === current) continue;
      current = key;
      chips.push({ messageId: message.id, origin: origin as OriginChip["origin"] });
    }
  } catch {
    // Un chip de menos nunca puede romper el hilo.
  }
  return chips;
}
