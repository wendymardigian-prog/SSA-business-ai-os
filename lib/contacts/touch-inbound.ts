/**
 * El toque de un mensaje entrante (F85).
 *
 * Los dos receptores de mensajes (Zernio para Instagram, Evolution para
 * WhatsApp) y el de email llaman a `recordInboundTouch` DESPUÉS de guardar el
 * mensaje. Todo lo que decide qué cuenta como toque vive acá y es puro, para
 * probarlo sin armar un webhook.
 *
 * **No cada mensaje es un toque.** Un contacto activo manda cientos, y una fila
 * "Instagram · mensaje directo" por cada uno no dice nada y hace que el "último
 * toque" cambie con cada "ok". Se registra solo lo que SUMA información:
 *
 *   - el primer mensaje del contacto,
 *   - una respuesta a una historia (de dónde vino la conversación),
 *   - un mensaje que trae datos de un anuncio (el anuncio es el origen),
 *   - el que vuelve después de una semana sin escribir (una vuelta real).
 *
 * **NUNCA falla.** El mensaje ya está guardado: que no se pueda anotar de dónde
 * vino no puede ser un error del webhook.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { recordTouch, type TouchInput } from "./touch";

type Db = SupabaseClient<Database>;

/** Cuánto sin escribir para que una vuelta cuente como un toque nuevo. */
export const RETURN_AFTER_DAYS = 7;

/** Lo que se sabe del anuncio que originó una conversación. */
export interface AdReferral {
  adId: string | null;
  ctwaClid: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  /** El título del anuncio, que es lo más cercano a "qué pieza fue". */
  title: string | null;
  ref: string | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const str = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : null;
};

/**
 * El `referral` que Zernio manda en la metadata del PRIMER mensaje después de un
 * clic en un anuncio (Instagram y Messenger traen `ad_id` y `ref`; WhatsApp
 * trae `ctwa_clid` y `source_id`).
 *
 * Lectura defensiva: ningún campo es seguro. Si no hay NADA usable devuelve null
 * y el mensaje se trata como uno común.
 */
export function fromZernioReferral(referral: unknown): AdReferral | null {
  if (!isObject(referral)) return null;

  const sourceType = str(referral.source_type) ?? str(referral.type);
  const sourceId = str(referral.source_id);
  const ads = isObject(referral.ads_context_data) ? referral.ads_context_data : null;

  const result: AdReferral = {
    // `source_id` es el id del anuncio cuando la fuente es un anuncio.
    adId: str(referral.ad_id) ?? (sourceType === "ad" ? sourceId : null),
    ctwaClid: str(referral.ctwa_clid),
    sourceType,
    sourceUrl: str(referral.source_url),
    title: str(referral.headline) ?? str(ads?.ad_title),
    ref: str(referral.ref),
  };

  const usable = result.adId || result.ctwaClid || result.ref || result.sourceUrl;
  return usable ? result : null;
}

/** Busca una clave en un objeto anidado, con tope de profundidad. */
function findKey(value: unknown, key: string, depth = 0): unknown {
  if (!isObject(value) || depth > 4) return undefined;
  if (key in value) return value[key];
  for (const nested of Object.values(value)) {
    const found = findKey(nested, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Un mensaje de WhatsApp (Baileys) que vino de un anuncio de "clic a WhatsApp"
 * trae `contextInfo.externalAdReply`. Se busca sin asumir en qué tipo de mensaje
 * está (texto, imagen, audio...): el campo es el mismo y la ruta cambia.
 *
 * Para no confundirlo con una vista previa de link común, se exige que sea de un
 * anuncio (`sourceType: "ad"`) o que traiga un `ctwaClid`.
 */
export function fromBaileysMessage(message: unknown): AdReferral | null {
  const ad = findKey(message, "externalAdReply");
  if (!isObject(ad)) return null;

  const sourceType = str(ad.sourceType);
  const ctwaClid = str(ad.ctwaClid);
  if (sourceType !== "ad" && !ctwaClid) return null;

  return {
    adId: sourceType === "ad" ? str(ad.sourceId) : null,
    ctwaClid,
    sourceType,
    sourceUrl: str(ad.sourceUrl),
    title: str(ad.title),
    ref: null,
  };
}

export type InboundTouchReason = "ad" | "story_reply" | "first_message" | "returned";

export interface InboundTouchContext {
  /** La plataforma del canal: instagram, whatsapp, email... */
  platform: string;
  /** El contacto ya existía antes de este mensaje. */
  contactExisted: boolean;
  isStoryReply: boolean;
  referral: AdReferral | null;
  /** Cuándo llegó el mensaje anterior de ESTE contacto en esta conversación. */
  previousInboundAt: Date | null;
  messageAt: Date;
}

/**
 * Si este mensaje es un toque, y por qué. Null = no suma información.
 *
 * Si coinciden varios motivos manda el que más dice del origen: un anuncio
 * explica la conversación mejor que "fue el primer mensaje".
 */
export function inboundTouchReason(ctx: InboundTouchContext): InboundTouchReason | null {
  if (ctx.referral) return "ad";
  if (ctx.isStoryReply) return "story_reply";
  if (!ctx.contactExisted) return "first_message";

  if (ctx.previousInboundAt) {
    const gapMs = ctx.messageAt.getTime() - ctx.previousInboundAt.getTime();
    if (gapMs >= RETURN_AFTER_DAYS * 86_400_000) return "returned";
  }
  return null;
}

/** El medio de cada motivo; el email es siempre "email". */
function mediumFor(platform: string, reason: InboundTouchReason): string {
  if (platform === "email") return "email";
  if (reason === "ad") return "paid_social";
  if (reason === "story_reply") return "story_reply";
  return "dm";
}

export interface InboundTouchParams {
  workspaceId: string;
  contactId: string;
  conversationId: string;
  platform: string;
  contactExisted: boolean;
  messageAt: Date;
  /** El id del mensaje en la plataforma: es lo que evita registrarlo dos veces. */
  platformMessageId: string | null;
  /** Nuestra fila del mensaje, para excluirla de "el mensaje anterior". */
  messageId: string | null;
  storyId?: string | null;
  referral?: AdReferral | null;
}

/**
 * El mensaje anterior de este contacto en esta conversación. Una consulta por el
 * índice `(conversation_id, created_at)`, y solo cuando las reglas baratas no
 * alcanzaron para decidir.
 */
async function previousInboundAt(supabase: Db, params: InboundTouchParams): Promise<Date | null> {
  if (!params.messageId) return null;

  const { data, error } = await supabase
    .from("messages")
    .select("created_at")
    .eq("conversation_id", params.conversationId)
    .eq("direction", "inbound")
    .neq("id", params.messageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.created_at) return null;
  const at = new Date(data.created_at);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Registra el toque de un mensaje entrante, si corresponde. `supabase` es el
 * cliente de servicio. Nunca lanza.
 */
export async function recordInboundTouch(supabase: Db, params: InboundTouchParams): Promise<void> {
  try {
    const referral = params.referral ?? null;
    const isStoryReply = Boolean(params.storyId);

    // Las reglas baratas primero: solo si ninguna decide se mira el historial.
    let reason = inboundTouchReason({
      platform: params.platform,
      contactExisted: params.contactExisted,
      isStoryReply,
      referral,
      previousInboundAt: null,
      messageAt: params.messageAt,
    });

    if (!reason) {
      reason = inboundTouchReason({
        platform: params.platform,
        contactExisted: params.contactExisted,
        isStoryReply,
        referral,
        previousInboundAt: await previousInboundAt(supabase, params),
        messageAt: params.messageAt,
      });
    }
    if (!reason) return;

    const touch: TouchInput = {
      occurredAt: params.messageAt,
      source: params.platform,
      medium: mediumFor(params.platform, reason),
      origin: "dm",
      dedupeKey: params.platformMessageId
        ? `msg:${params.platformMessageId}`
        : `msg:${params.conversationId}:${params.messageAt.toISOString()}`,
      ...(referral
        ? {
            adId: referral.adId,
            ctwaClid: referral.ctwaClid,
            content: referral.title,
            landingPage: referral.sourceUrl,
          }
        : {}),
      raw: {
        message_id: params.platformMessageId,
        story_id: params.storyId ?? undefined,
        referral: referral
          ? {
              ad_id: referral.adId,
              ctwa_clid: referral.ctwaClid,
              source_type: referral.sourceType,
              source_url: referral.sourceUrl,
              ref: referral.ref,
              headline: referral.title,
            }
          : undefined,
      },
    };

    await recordTouch(supabase, {
      workspaceId: params.workspaceId,
      contactId: params.contactId,
      touch,
    });
  } catch (err) {
    console.error("[atribucion] fallo el toque del mensaje:", err instanceof Error ? err.message : String(err));
  }
}
