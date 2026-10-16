/**
 * Recuperar el anuncio de origen de una conversación de Instagram desde Zernio (Extra L, Tirón 2, A1).
 *
 * Meta manda los datos del anuncio SOLO en el primer mensaje después del clic. Si ese mensaje llegó sin ellos, el toque
 * quedó como un mensaje directo orgánico. Zernio guarda el anuncio en la conversación (`metadata.meta_ad_id`, una sola vez,
 * sin pisarlo), así que se le pregunta UNA vez por conversación y se completa el toque (`enrich_touch_ad_origin`, 00221).
 *
 * - Solo Instagram: en este sistema WhatsApp va por Evolution y su `ctwa_*` ya viene en el mensaje.
 * - Una sola vez por conversación: se encola únicamente con el PRIMER mensaje entrante, con clave de dedupe.
 * - Nunca lanza por un fallo de Zernio (la cola reintentaría a los 10 s encima de la espera propia): reagenda a 1, 5 y 15 min.
 * - Nunca pisa un anuncio que el toque ya tenía ni un vínculo hecho a mano (lo garantiza la función de la base).
 *
 * Las decisiones (qué se pregunta, cómo se lee la respuesta, cuándo se reintenta) son funciones puras, con test.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { scheduleJob } from "@/lib/scheduler";
import { createZernioClient, type Zernio } from "@/lib/zernio-client";
import { getZernioKeyState } from "@/lib/integrations/zernio-key";
import { recordInboundTouch } from "@/lib/contacts/touch-inbound";
import { touchAccountOf, type TouchAccount } from "@/lib/inbox/accounts";

type Db = SupabaseClient<Database>;

export const ZERNIO_AD_ORIGIN_JOB = "zernio_ad_origin";

/** Espera antes de preguntar: Zernio tarda un momento en guardar la conversación. */
export const AD_ORIGIN_DELAY_SECONDS = 20;
/** Entre un intento fallido y el siguiente (minutos). Tras el último, se deja de intentar. */
export const AD_ORIGIN_RETRY_MINUTES = [1, 5, 15] as const;

export interface AdOriginFromZernio {
  adId: string;
  title: string | null;
  postId: string | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const str = (value: unknown, max = 500): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/**
 * El anuncio que Zernio guardó en la conversación. Acepta la respuesta del SDK (`{ data: { data: {...} } }`), el cuerpo
 * (`{ data: {...} }`) o la conversación sola, porque el SDK no es estable en eso. Lectura defensiva: ningún campo es seguro.
 */
export function adOriginFromConversation(response: unknown): AdOriginFromZernio | null {
  try {
    let node: unknown = response;
    for (let depth = 0; depth < 3 && isObject(node); depth++) {
      if (isObject(node.metadata)) break;
      node = node.data;
    }
    if (!isObject(node) || !isObject(node.metadata)) return null;
    const adId = str(node.metadata.meta_ad_id);
    if (!adId) return null;
    return { adId, title: str(node.metadata.meta_ad_title), postId: str(node.metadata.meta_ad_post_id) };
  } catch {
    return null;
  }
}

export interface LookupDecisionInput {
  platform: string;
  /** El mensaje ya trajo un anuncio utilizable: no hay nada que recuperar. */
  hasReferral: boolean;
  /** Cuántos mensajes entrantes tiene la conversación (con este incluido). */
  inboundCount: number;
  hasLateConversationId: boolean;
  hasPlatformMessageId: boolean;
}

/** ¿Se le pregunta a Zernio por el anuncio de esta conversación? Solo Instagram, solo con el primer mensaje y sin anuncio a la vista. */
export function shouldLookUpAdOrigin(input: LookupDecisionInput): boolean {
  return (
    input.platform === "instagram" &&
    !input.hasReferral &&
    input.inboundCount === 1 &&
    input.hasLateConversationId &&
    input.hasPlatformMessageId
  );
}

/** Cuándo reintentar tras `attempt` intentos fallidos (empieza en 1), o null si ya no hay más. */
export function adOriginRetryDelayMinutes(attempt: number): number | null {
  if (!Number.isFinite(attempt) || attempt < 1) return AD_ORIGIN_RETRY_MINUTES[0];
  return AD_ORIGIN_RETRY_MINUTES[attempt - 1] ?? null;
}

/** Un fallo de Zernio que vale la pena reintentar: límite de uso, error del servidor o de la red. Un 400/401/403/404 no se arregla esperando. */
export function isRetryableZernioFailure(err: unknown): boolean {
  const status = isObject(err) ? Number((err as { statusCode?: unknown }).statusCode ?? (err as { status?: unknown }).status) : NaN;
  if (!Number.isFinite(status)) return true; // sin código: caída de red o algo que no sabemos leer
  return status === 429 || status >= 500;
}

/** `messages.origin_context` con el anuncio sumado (lista blanca, igual que `buildOriginContext`). Si ya tenía un anuncio, queda igual. */
export function originContextWithAd(existing: unknown, ad: AdOriginFromZernio): Record<string, unknown> {
  const base = isObject(existing) ? { ...existing } : {};
  if (isObject(base.ad)) return base;
  return {
    ...base,
    ad: {
      ad_id: ad.adId,
      ...(ad.title ? { title: ad.title } : {}),
      ...(ad.postId ? { post_id: ad.postId } : {}),
      platform: "instagram",
    },
  };
}

// ── Encolar ────────────────────────────────────────────────────────────────

export interface AdOriginPayload {
  workspaceId: string;
  contactId: string;
  conversationId: string;
  channelId: string;
  lateConversationId: string;
  /** La cuenta de Zernio del canal (`channels.late_account_id`). */
  lateAccountId: string;
  messageId: string | null;
  platformMessageId: string;
  /** Cuándo llegó el mensaje (ISO): el toque se fecha en ese momento, no cuando se encuentra el anuncio. */
  messageAt: string;
  attempt?: number;
}

export const adOriginDedupeKey = (conversationId: string) => `zernio-ad-origin:${conversationId}`;

export interface EnqueueParams extends Omit<AdOriginPayload, "attempt" | "platformMessageId"> {
  platform: string;
  hasReferral: boolean;
  platformMessageId: string | null;
}

/**
 * Encola la búsqueda del anuncio si corresponde. NUNCA lanza: el mensaje ya está guardado y el toque ya está anotado,
 * y que no se pueda encolar esto no es un error del webhook.
 */
export async function maybeEnqueueAdOriginLookup(db: Db, params: EnqueueParams): Promise<boolean> {
  try {
    if (params.platform !== "instagram" || params.hasReferral || !params.platformMessageId || !params.lateConversationId) return false;

    const { count, error } = await db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", params.conversationId)
      .eq("direction", "inbound");
    if (error) return false;

    if (
      !shouldLookUpAdOrigin({
        platform: params.platform,
        hasReferral: params.hasReferral,
        inboundCount: count ?? 0,
        hasLateConversationId: Boolean(params.lateConversationId),
        hasPlatformMessageId: Boolean(params.platformMessageId),
      })
    ) {
      return false;
    }

    const payload: AdOriginPayload = {
      workspaceId: params.workspaceId,
      contactId: params.contactId,
      conversationId: params.conversationId,
      channelId: params.channelId,
      lateConversationId: params.lateConversationId,
      lateAccountId: params.lateAccountId,
      messageId: params.messageId,
      platformMessageId: params.platformMessageId,
      messageAt: params.messageAt,
    };
    await scheduleJob(
      db,
      ZERNIO_AD_ORIGIN_JOB,
      payload as unknown as Record<string, unknown>,
      new Date(Date.now() + AD_ORIGIN_DELAY_SECONDS * 1000),
      adOriginDedupeKey(params.conversationId),
    );
    return true;
  } catch (err) {
    // Un job pendiente con la misma clave (23505) es lo esperado si dos mensajes llegan juntos.
    const code = isObject(err) ? (err as { code?: unknown }).code : undefined;
    if (code !== "23505") console.error("[atribucion] no pude encolar la busqueda del anuncio:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

// ── Correr ─────────────────────────────────────────────────────────────────

export type AdOriginOutcome =
  | "enriched" // el toque quedó con su anuncio
  | "recorded" // no había toque del mensaje: se anotó uno con el anuncio
  | "unchanged" // el toque ya tenía un anuncio o una persona lo decidió
  | "no_ad" // la conversación no vino de un anuncio
  | "no_key" // el workspace no tiene Zernio
  | "retry" // falló algo que se arregla esperando: se reagendó
  | "gave_up"; // falló y ya no se reintenta

export interface AdOriginDeps {
  zernio?: Pick<Zernio, "messages">;
  schedule?: typeof scheduleJob;
  now?: () => Date;
}

export async function runZernioAdOrigin(db: Db, payload: AdOriginPayload, deps: AdOriginDeps = {}): Promise<AdOriginOutcome> {
  const now = deps.now ?? (() => new Date());
  const schedule = deps.schedule ?? scheduleJob;
  const attempt = payload.attempt ?? 1;

  const retryLater = async (reason: string): Promise<AdOriginOutcome> => {
    const minutes = adOriginRetryDelayMinutes(attempt);
    if (minutes === null) {
      console.warn(`[atribucion] anuncio de origen: sin mas intentos (${reason})`);
      return "gave_up";
    }
    try {
      await schedule(
        db,
        ZERNIO_AD_ORIGIN_JOB,
        { ...payload, attempt: attempt + 1 } as unknown as Record<string, unknown>,
        new Date(now().getTime() + minutes * 60_000),
        adOriginDedupeKey(payload.conversationId),
      );
      return "retry";
    } catch (err) {
      console.error("[atribucion] no pude reagendar la busqueda del anuncio:", err instanceof Error ? err.message : String(err));
      return "gave_up";
    }
  };

  // La clave de Zernio: sin ella no hay a quién preguntarle (no se reintenta); si no se pudo LEER, sí.
  let zernio = deps.zernio;
  if (!zernio) {
    const keyState = await getZernioKeyState(payload.workspaceId, { supabase: db });
    if (keyState.state === "absent") return "no_key";
    if (keyState.state !== "present") return retryLater("no se pudo leer la clave de Zernio");
    zernio = createZernioClient(keyState.key);
  }

  let response: unknown;
  try {
    response = await zernio.messages.getInboxConversation({
      path: { conversationId: payload.lateConversationId },
      query: { accountId: payload.lateAccountId },
    });
  } catch (err) {
    return isRetryableZernioFailure(err) ? retryLater(err instanceof Error ? err.message : "error de Zernio") : "gave_up";
  }

  const ad = adOriginFromConversation(response);
  if (!ad) return "no_ad";

  // 1. El mensaje: su origen queda a la vista en la bandeja y en las automatizaciones. Si falla, el toque se completa igual.
  if (payload.messageId) {
    try {
      const { data: row } = await db.from("messages").select("origin_context").eq("id", payload.messageId).maybeSingle();
      const current = (row as { origin_context?: unknown } | null)?.origin_context ?? null;
      const next = originContextWithAd(current, ad);
      if (next !== current && !(isObject(current) && isObject(current.ad))) {
        await db.from("messages").update({ origin_context: next as unknown as Json } as never).eq("id", payload.messageId);
      }
    } catch (err) {
      console.error("[atribucion] no pude guardar el anuncio en el mensaje:", err instanceof Error ? err.message : String(err));
    }
  }

  // 2. El toque del mensaje.
  const dedupeKey = `msg:${payload.platformMessageId}`;
  const { data, error } = await db.rpc("enrich_touch_ad_origin", {
    p_workspace_id: payload.workspaceId,
    p_dedupe_key: dedupeKey,
    p_ad_id: ad.adId,
    p_title: ad.title ?? undefined,
    p_post_id: ad.postId ?? undefined,
  });
  if (error) return retryLater(error.message);

  const result = (data ?? {}) as { ok?: boolean; changed?: boolean; error?: string };
  if (result.ok && result.changed) return "enriched";
  if (result.ok) return "unchanged";

  if (result.error === "touch_not_found") {
    // Un contacto que ya existía y abre una conversación nueva no tiene toque de ese mensaje: se anota uno con el anuncio,
    // fechado cuando llegó el mensaje (el mismo que habría anotado el webhook con el `referral`).
    // La cuenta por la que entro la conversacion (varias cuentas de Instagram): si no se puede leer, el toque queda sin ella.
    let account: TouchAccount | null = null;
    try {
      const { data: channel } = await db
        .from("channels")
        .select("late_account_id, platform, username, display_name")
        .eq("id", payload.channelId)
        .maybeSingle();
      if (channel) account = touchAccountOf(channel);
    } catch (err) {
      console.error("[atribucion] no pude leer la cuenta del toque:", err instanceof Error ? err.message : String(err));
    }
    await recordInboundTouch(db, {
      workspaceId: payload.workspaceId,
      contactId: payload.contactId,
      conversationId: payload.conversationId,
      account,
      platform: "instagram",
      contactExisted: true,
      messageAt: new Date(payload.messageAt),
      platformMessageId: payload.platformMessageId,
      messageId: payload.messageId,
      referral: { adId: ad.adId, ctwaClid: null, sourceType: "ad", sourceUrl: null, title: ad.title, ref: null, postId: ad.postId },
    });
    return "recorded";
  }

  return "gave_up";
}
