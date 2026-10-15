/**
 * El CANAL de un toque (Extra I, F30): organico, pauta, referido o directo.
 *
 * Es la gemela en TypeScript de `public.touch_channel` (SQL, migracion 00230): las dos corren los mismos casos de
 * `channel.cases.json` (Vitest para esta; `scripts/verify-organic-attribution.mjs` para la de la base). Si se cambia
 * una regla, se cambia en las dos y se suma el caso.
 *
 * El canal responde "¿esto lo trajo algo que pagamos, algo que publicamos, una persona o nada identificable?" y
 * NO reemplaza a `source`/`medium` (el DONDE y el COMO de `taxonomy.ts`): es la clasificacion de arriba, la que
 * deja agrupar un dashboard sin entrar en el detalle.
 *
 * Orden de evaluacion (el primero que se cumple gana): paid > referral > organic > direct.
 *
 * Modulo PURO y sin dependencias: nunca lanza.
 */

/** Los cuatro canales (el CHECK de `contact_touches.channel`). */
export const TOUCH_CHANNELS = ["organic", "paid", "referral", "direct"] as const;
export type TouchChannel = (typeof TOUCH_CHANNELS)[number];

/** Lo que `touchChannel` necesita de un toque. Todo opcional: lo que no vino es null. */
export interface TouchChannelInput {
  origin?: string | null;
  medium?: string | null;
  source?: string | null;
  ad_id?: string | null;
  adset_id?: string | null;
  campaign_id?: string | null;
  meta_ad_id?: string | null;
  meta_campaign_id?: string | null;
  gclid?: string | null;
  ttclid?: string | null;
  li_fat_id?: string | null;
  ctwa_clid?: string | null;
  fbclid?: string | null;
  social_post_id?: string | null;
  content_post_id?: string | null;
}

/** En lenguaje claro, para la pantalla (F37). */
export const CHANNEL_LABELS: Record<TouchChannel, string> = {
  organic: "Orgánico",
  paid: "Pauta",
  referral: "Referido",
  direct: "Directo",
};

/** Los `medium` que dicen "esto fue pagado". */
export const PAID_MEDIUMS: readonly string[] = ["paid_social", "cpc", "ppc", "paid", "display", "paidsocial", "paid_search"];

/** Los `medium` que dicen "esto vino de nuestro contenido" aunque no se sepa de que pieza. */
export const ORGANIC_MEDIUMS: readonly string[] = ["comment", "story_reply", "story_mention", "organic_social", "social", "dm_link"];

/** Redes en las que un DM sin mas dato es contenido organico (en WhatsApp o email no hay forma de saberlo). */
export const ORGANIC_DM_SOURCES: readonly string[] = ["instagram", "tiktok", "facebook", "youtube", "linkedin", "threads", "twitter"];

/** El medium que deja el selector de la venta (F47) para un referido. */
export const REFERRAL_MEDIUM = "referral_person";

/** Texto en minusculas y recortado, o null si queda vacio. (Gemela de `nullif(lower(btrim(x)), '')`.) */
const lowered = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const t = value.trim().toLowerCase();
  return t === "" ? null : t;
};

/** Hay un dato: texto no vacio despues de recortar. (Gemela de `nullif(btrim(x), '') is not null`.) */
const has = (value: string | null | undefined): boolean => typeof value === "string" && value.trim() !== "";

/** El canal de un toque. Nunca lanza: ante cualquier cosa rara, `direct`. */
export function touchChannel(input: TouchChannelInput | null | undefined): TouchChannel {
  if (!input || typeof input !== "object") return "direct";

  const origin = lowered(input.origin);
  const medium = lowered(input.medium);
  const source = lowered(input.source);

  // 1) Pauta. `fbclid` SOLO no alcanza: Meta lo agrega tambien a clics organicos.
  if (
    has(input.ad_id) ||
    has(input.adset_id) ||
    has(input.campaign_id) ||
    has(input.meta_ad_id) ||
    has(input.meta_campaign_id) ||
    has(input.gclid) ||
    has(input.ttclid) ||
    has(input.li_fat_id) ||
    has(input.ctwa_clid) ||
    (medium !== null && PAID_MEDIUMS.includes(medium))
  ) {
    return "paid";
  }

  // 2) Referido (lo deja el selector de la venta).
  if (medium === REFERRAL_MEDIUM) return "referral";

  // 3) Organico.
  if (
    has(input.social_post_id) ||
    has(input.content_post_id) ||
    (medium !== null && ORGANIC_MEDIUMS.includes(medium)) ||
    (origin === "dm" && source !== null && ORGANIC_DM_SOURCES.includes(source))
  ) {
    return "organic";
  }

  // 4) Cualquier otro caso.
  return "direct";
}

/** ¿Es un canal con origen identificado? (Todo menos `direct`: lo que cuenta `contact_last_origin_touch`.) */
export function isOriginChannel(channel: string | null | undefined): channel is Exclude<TouchChannel, "direct"> {
  return channel === "organic" || channel === "paid" || channel === "referral";
}
