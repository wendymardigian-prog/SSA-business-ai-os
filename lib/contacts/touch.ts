/**
 * Registrar un toque de atribución (F83).
 *
 * `recordTouch` es el ÚNICO camino por el que algo se anota en
 * `contact_touches`: los receptores de mensajes, el de comentarios, el alta
 * manual, la importación y el agendamiento pasan todos por acá. Quien necesite
 * un camino nuevo (un formulario, una página) suma una llamada, no una tabla.
 *
 * **NUNCA lanza.** Un fallo de atribución no puede tumbar la recepción de un
 * mensaje: el lead escribió, y que su mensaje no se guarde porque falló una
 * estadística es perder justo lo que el sistema existe para no perder. Todo
 * error se loguea y se devuelve como `recorded: false`.
 *
 * El primero y el último toque no se calculan acá: los recalcula la función
 * `record_contact_touch` de la base (00114) desde la tabla, para que un toque
 * viejo que llega tarde —una relectura— quede en su lugar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/lib/types/database";
import { ORIGINS, normalizeMedium, normalizeSource, type TouchOrigin } from "./taxonomy";

type Db = SupabaseClient<Database>;

/** Lo que cada camino le pasa. Todo opcional salvo lo que identifica el toque. */
export interface TouchInput {
  /** Cuándo pasó. Sin esto, ahora. */
  occurredAt?: Date | string | null;
  source: string;
  medium?: string | null;
  campaign?: string | null;
  /** La pieza, en palabras (`utm_content`). */
  content?: string | null;
  term?: string | null;
  socialPostId?: string | null;
  contentPostId?: string | null;
  adId?: string | null;
  adsetId?: string | null;
  campaignId?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
  ttclid?: string | null;
  liFatId?: string | null;
  ctwaClid?: string | null;
  referrerUrl?: string | null;
  landingPage?: string | null;
  origin: TouchOrigin;
  /** El id del mensaje, comentario, evento o reserva: lo que evita duplicar. */
  dedupeKey: string;
  /** La carga original; se recorta a una lista blanca antes de guardarla. */
  raw?: unknown;
}

const text = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish();

const uuid = z.string().uuid().nullish();

const schema = z.object({
  occurredAt: z.union([z.date(), z.string()]).nullish(),
  source: z.string().trim().min(1).max(100),
  medium: text(100),
  campaign: text(),
  content: text(),
  term: text(),
  socialPostId: uuid,
  contentPostId: uuid,
  adId: text(100),
  adsetId: text(100),
  campaignId: text(100),
  fbclid: text(),
  gclid: text(),
  ttclid: text(),
  liFatId: text(),
  ctwaClid: text(),
  referrerUrl: text(),
  landingPage: text(),
  origin: z.enum(ORIGINS),
  dedupeKey: z.string().trim().min(1).max(200),
  raw: z.unknown().optional(),
});

/**
 * Las claves de la carga original que se conservan. Una LISTA BLANCA y no una
 * lista negra: lo que no está acá no se guarda, así que un token, una clave o un
 * dato personal que aparezca mañana en un payload no puede colarse.
 */
const RAW_KEYS = new Set([
  "message_id", "comment_id", "event_id", "story_id", "post_id", "platform",
  "backfill", "booking_origin", "utm", "referral",
  // utm_*
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  // datos de anuncio (Zernio y Baileys)
  "ad_id", "adset_id", "campaign_id", "ref", "source", "type", "source_id",
  "source_type", "source_url", "headline", "ctwa_clid", "title", "media_type",
  "fbclid", "gclid", "ttclid", "li_fat_id",
]);

/** Cuánto texto puede tener un valor guardado en `raw`. */
const RAW_VALUE_MAX = 300;

/**
 * Recorta una carga a las claves permitidas y a valores simples. Hasta dos
 * niveles de objetos (el `referral` de un anuncio, el `utm` de una reserva);
 * más profundo no hace falta y es donde se escondería lo que no se quiere.
 */
export function sanitizeRaw(value: unknown, depth = 0): Record<string, Json> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: Record<string, Json> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!RAW_KEYS.has(key)) continue;

    if (typeof entry === "string") out[key] = entry.slice(0, RAW_VALUE_MAX);
    else if (typeof entry === "number" || typeof entry === "boolean") out[key] = entry;
    else if (entry && typeof entry === "object" && !Array.isArray(entry) && depth < 2) {
      const nested = sanitizeRaw(entry, depth + 1);
      if (Object.keys(nested).length > 0) out[key] = nested;
    }
  }
  return out;
}

/** El toque ya validado y normalizado, con las claves que espera la base. */
export interface CleanTouch {
  [key: string]: Json | undefined;
  source: string;
  origin: TouchOrigin;
  dedupe_key: string;
}

export type ParsedTouch = { ok: true; touch: CleanTouch } | { ok: false; reason: string };

/**
 * Valida, normaliza y decide si el toque vale la pena.
 *
 * Un toque sin ningún dato atribuible no se registra: una fila "instagram, sin
 * nada más" para cada mensaje no dice nada y pisa el último toque con ruido.
 * Sí vale con solo la fuente cuando el origen lo justifica (un DM, un
 * comentario), pero esa decisión es de quien llama; acá solo se exige fuente.
 */
export function parseTouch(input: TouchInput): ParsedTouch {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? "toque invalido" };
  }
  const t = parsed.data;

  const source = normalizeSource(t.source);
  if (!source) return { ok: false, reason: "sin fuente" };

  const medium = normalizeMedium(t.medium);
  const occurred = t.occurredAt ? new Date(t.occurredAt) : null;
  if (occurred && Number.isNaN(occurred.getTime())) return { ok: false, reason: "fecha invalida" };

  const defined = <T extends Record<string, Json | undefined>>(obj: T) =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined)) as T;

  return {
    ok: true,
    touch: defined({
      occurred_at: occurred ? occurred.toISOString() : undefined,
      source,
      medium: medium.medium,
      medium_raw: medium.raw ? true : undefined,
      campaign: t.campaign,
      content: t.content,
      term: t.term,
      social_post_id: t.socialPostId,
      content_post_id: t.contentPostId,
      ad_id: t.adId,
      adset_id: t.adsetId,
      campaign_id: t.campaignId,
      fbclid: t.fbclid,
      gclid: t.gclid,
      ttclid: t.ttclid,
      li_fat_id: t.liFatId,
      ctwa_clid: t.ctwaClid,
      referrer_url: t.referrerUrl,
      landing_page: t.landingPage,
      origin: t.origin,
      dedupe_key: t.dedupeKey,
      raw: sanitizeRaw(t.raw),
    }) as CleanTouch,
  };
}

export interface RecordTouchResult {
  /** Quedó una fila nueva. `false` también cuando ya estaba (el mismo toque). */
  recorded: boolean;
  reason?: string;
}

/**
 * Anota un toque. `supabase` tiene que ser el cliente de SERVICIO: la función de
 * la base solo la ejecuta `service_role`.
 */
export async function recordTouch(
  supabase: Db,
  params: { workspaceId: string; contactId: string; touch: TouchInput },
): Promise<RecordTouchResult> {
  try {
    const parsed = parseTouch(params.touch);
    if (!parsed.ok) {
      return { recorded: false, reason: parsed.reason };
    }

    const { data, error } = await supabase.rpc("record_contact_touch", {
      p_workspace_id: params.workspaceId,
      p_contact_id: params.contactId,
      p_touch: parsed.touch as Json,
    });

    if (error) {
      // Sin el contenido del toque: el log no lleva datos del lead.
      console.error("[atribucion] no pude registrar el toque:", error.message);
      return { recorded: false, reason: "error" };
    }

    return { recorded: data?.inserted === true, reason: data?.reason };
  } catch (err) {
    console.error("[atribucion] fallo registrando el toque:", err instanceof Error ? err.message : String(err));
    return { recorded: false, reason: "error" };
  }
}
