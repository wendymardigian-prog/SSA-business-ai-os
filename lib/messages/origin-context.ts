/**
 * De dónde vino un mensaje entrante (Extra L, F19): la respuesta a una historia, la mención en una historia
 * o el anuncio que originó la conversación. Se guarda en `messages.origin_context` (00189) con una LISTA BLANCA
 * y se lee desde las automatizaciones («Solo si vino de un anuncio», `{{message_origin.ad_title}}`).
 *
 * PURO y NUNCA lanza: los datos vienen de un proveedor y ningún campo es seguro. Que no se pueda armar o
 * guardar no puede hacer fallar la recepción de un mensaje.
 */
import { fromBaileysMessage, fromZernioReferral, type AdReferral } from "@/lib/contacts/touch-inbound";

export interface OriginContext {
  story_reply?: { story_id: string; story_url?: string };
  /** Instagram: alguien mencionó la cuenta en SU historia. */
  story_mention?: true;
  ad?: {
    ad_id?: string;
    ctwa_clid?: string;
    source_type?: string;
    source_url?: string;
    title?: string;
    ref?: string;
    post_id?: string;
    /** instagram, whatsapp, messenger… (la plataforma del canal por el que llegó). */
    platform: string;
  };
  quoted_message_id?: string;
}

const text = (value: unknown, max = 500): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

function adFrom(referral: AdReferral | null, platform: string): OriginContext["ad"] | undefined {
  if (!referral) return undefined;
  const ad: NonNullable<OriginContext["ad"]> = { platform };
  const pairs: Array<[keyof NonNullable<OriginContext["ad"]>, string | null | undefined]> = [
    ["ad_id", referral.adId],
    ["ctwa_clid", referral.ctwaClid],
    ["source_type", referral.sourceType],
    ["source_url", referral.sourceUrl],
    ["title", referral.title],
    ["ref", referral.ref],
    ["post_id", referral.postId],
  ];
  for (const [key, value] of pairs) {
    const clean = text(value);
    if (clean) (ad as Record<string, string>)[key] = clean;
  }
  return ad;
}

export interface OriginInput {
  /** La plataforma del canal. */
  platform: string;
  storyReply?: { storyId?: unknown; storyUrl?: unknown } | null;
  isStoryMention?: boolean | null;
  /** El `metadata.referral` de Zernio, tal cual vino. */
  zernioReferral?: unknown;
  /** El mensaje de Baileys (WhatsApp), donde puede venir `externalAdReply`. */
  baileysMessage?: unknown;
  quotedMessageId?: unknown;
}

/** El contexto de origen, o null si el mensaje no vino de nada de esto (el caso de casi todos). */
export function buildOriginContext(input: OriginInput): OriginContext | null {
  try {
    const out: OriginContext = {};

    const storyId = text(input.storyReply?.storyId, 200);
    if (storyId) {
      const storyUrl = text(input.storyReply?.storyUrl, 1000);
      out.story_reply = { story_id: storyId, ...(storyUrl ? { story_url: storyUrl } : {}) };
    }
    // Responder a una historia y mencionarla son excluyentes (Zernio): si vienen las dos, manda la respuesta.
    if (input.isStoryMention === true && !out.story_reply) out.story_mention = true;

    const referral = input.zernioReferral !== undefined ? fromZernioReferral(input.zernioReferral) : fromBaileysMessage(input.baileysMessage);
    const ad = adFrom(referral, input.platform);
    if (ad) out.ad = ad;

    const quoted = text(input.quotedMessageId, 200);
    if (quoted) out.quoted_message_id = quoted;

    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Lo que `isStoryMention`, el anuncio y el título de un mensaje dejan en las variables de un flujo. */
export interface MessageOriginFacts {
  isStoryMention?: boolean;
  adId?: string;
  adTitle?: string;
}

/**
 * `{{message_origin.ad_id}}`, `{{message_origin.ad_title}}` y `{{message_origin.is_story_mention}}`.
 * (No `{{message.ad_id}}`: `{{message}}` ya es el TEXTO del mensaje y no puede tener propiedades.)
 * Null si el mensaje no trae nada de esto.
 */
export function messageOriginVariables(facts: MessageOriginFacts): { ad_id: string; ad_title: string; is_story_mention: string } | null {
  if (!facts.adId && !facts.adTitle && !facts.isStoryMention) return null;
  return { ad_id: facts.adId ?? "", ad_title: facts.adTitle ?? "", is_story_mention: facts.isStoryMention ? "true" : "false" };
}

/** El anuncio de un mensaje, para que un flujo lo lea (`{{message_origin.ad_id}}`, filtro «solo si vino de un anuncio»). */
export function adOriginOf(zernioReferral: unknown): { adId?: string; adTitle?: string; fromAd: true } | null {
  try {
    const referral = fromZernioReferral(zernioReferral);
    if (!referral) return null;
    return { fromAd: true, ...(referral.adId ? { adId: referral.adId } : {}), ...(referral.title ? { adTitle: referral.title } : {}) };
  } catch {
    return null;
  }
}

/** Lo mismo para un mensaje de WhatsApp (Baileys, `externalAdReply`). */
export function adOriginOfBaileys(message: unknown): { adId?: string; adTitle?: string; fromAd: true } | null {
  try {
    const referral = fromBaileysMessage(message);
    if (!referral) return null;
    return { fromAd: true, ...(referral.adId ? { adId: referral.adId } : {}), ...(referral.title ? { adTitle: referral.title } : {}) };
  } catch {
    return null;
  }
}
