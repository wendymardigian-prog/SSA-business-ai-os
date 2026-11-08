/**
 * La gemela en TypeScript de `public.resolve_meta_match` (migraciones 00192, 00299 y 00318).
 *
 * Resuelve los datos de un toque (ids de Meta, UTMs) contra el catalogo de Meta y dice a que anuncio, conjunto y
 * campaña corresponde, con el metodo y, si no se pudo, el motivo.
 *
 * **Tiene que dar EXACTAMENTE lo mismo que la funcion SQL**: los mismos casos (`meta-match.cases.json`) corren contra
 * las dos, en Vitest y en `verify-ads-attribution.mjs`. Si se cambia una regla, se cambia en las dos y se suma el caso.
 *
 * El orden (00318):
 *   1. Por id: ad_id / utm_content = id de anuncio; adset_id / utm_term = id de conjunto; campaign_id / utm_campaign = id.
 *   2. Una REGLA (`meta_match_rules`): «estos UTMs = este anuncio» o «no es un anuncio». Nunca contradice un id.
 *   3. El anuncio por nombre exacto, unico dentro del conjunto o la campaña conocidos por id.
 *   4. Sin ids: la campaña por su nombre exacto si es unico; si no, por parecido (sus palabras contienen todas las del UTM).
 *   5. El anuncio por nombre exacto dentro de esa campaña.
 *   6. El anuncio por PARECIDO: el unico del alcance cuyas palabras contienen todas las del utm_content (dos palabras o
 *      un codigo como «n4»). Nunca contra el catalogo entero. Lo que sale de aca queda «para revisar».
 *   7. El unico anuncio del conjunto.
 *
 * Modulo puro: no sabe de Supabase.
 */

import { metaNameKey } from "@/lib/meta/name-key";

export interface MetaRule {
  campaignKey: string;
  contentKey: string;
  termKey: string;
  action: "link" | "ignore";
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
}

export interface MetaCatalog {
  campaigns: Array<{ campaignId: string; nameKey: string }>;
  adsets: Array<{ adsetId: string; campaignId: string | null }>;
  ads: Array<{ adId: string; adsetId: string | null; campaignId: string | null; nameKey: string }>;
  rules?: MetaRule[];
}

export interface MetaMatchInput {
  adId?: string | null;
  adsetId?: string | null;
  campaignId?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  fbclid?: string | null;
}

export type MetaMatchStatus = "none" | "matched" | "unmatched" | "ignored";

export interface MetaMatchResult {
  status: MetaMatchStatus;
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
  method: string | null;
  reason: string | null;
}

/** Los metodos que se hallaron por parecido: quedan vinculados y van a «Para revisar». */
export const REVIEW_METHODS = ["utm_content_similar_adset", "utm_content_similar_campaign", "utm_campaign_similar"] as const;
export const isReviewMethod = (method: string | null | undefined): boolean => !!method && (REVIEW_METHODS as readonly string[]).includes(method);

/** Lo que de un toque hace falta para saber si trae datos de Meta (columnas de `contact_touches`). */
export interface TouchForMatch {
  origin: string;
  adId?: string | null;
  adsetId?: string | null;
  campaignId?: string | null;
  /** `utm_source`, en minusculas. Sin fuente cuenta como generica. */
  source?: string | null;
  /** La columna `medium` (un formulario dice «form»). */
  medium?: string | null;
  /** El `utm_medium` que llego: vive en `raw` (ver `touchUtmMedium`). */
  utmMedium?: string | null;
  /** `utm_id`: vive en `raw` (ver `touchUtmId`). */
  utmId?: string | null;
  /** UTM campaign. */
  campaign?: string | null;
  /** UTM content: en un comentario o un DM organico es el TITULO de la publicacion, no un UTM. */
  contentLabel?: string | null;
  term?: string | null;
  fbclid?: string | null;
}

/** Los origenes de un toque que pueden traer UTMs de verdad. */
const UTM_ORIGINS = new Set(["booking", "form", "webhook", "import", "manual"]);

/** Las fuentes que pueden traer un anuncio de Meta, y las genericas de un toque sin `utm_source` (`private.meta_source_counts`). */
const META_SOURCES = new Set(["meta", "facebook", "fb", "instagram", "ig", "msg", "an", "web"]);
const isMetaSource = (source: string | null | undefined) => {
  const v = trimmed(source)?.toLowerCase();
  return !v || META_SOURCES.has(v);
};
/** Las fuentes que solo pueden ser un anuncio de Meta (cuentan sin un medium pago). */
const STRONG_META_SOURCES = new Set(["meta", "facebook", "meta_ads", "facebook_ads", "fb_ads"]);
/** `private.meta_medium_is_paid`. */
export const META_PAID_MEDIUMS: readonly string[] = ["paid", "paid_social", "paidsocial", "paid-social", "cpc", "ppc", "cpm", "display", "paid_search", "ads", "ad"];
/** `private.meta_medium_is_organic`: con uno de estos, los UTMs no son de un anuncio. */
export const META_ORGANIC_MEDIUMS: readonly string[] = [
  "social", "organic", "organic_social", "bio", "link_in_bio", "referral", "email", "newsletter", "dm", "dm_link", "story",
  "story_reply", "story_mention", "comment", "whatsapp", "whatsapp_group", "sms",
];
const isNumeric = (value: string | null | undefined) => /^\d+$/.test(trimmed(value) ?? "");

/** El `utm_id` de un toque: un formulario lo guarda en `raw.utm_id`; una reunion, en `raw.utm.utm_id`. */
export function touchUtmId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { utm_id?: unknown; utm?: { utm_id?: unknown } | null };
  const value = r.utm_id ?? r.utm?.utm_id;
  return typeof value === "string" ? trimmed(value) : null;
}

/** El `utm_medium` que llego: `raw.utm.utm_medium` (formulario, reunion) o `raw.utm_medium`. */
export function touchUtmMedium(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { utm_medium?: unknown; utm?: { utm_medium?: unknown } | null };
  const value = r.utm?.utm_medium ?? r.utm_medium;
  return typeof value === "string" ? trimmed(value) : null;
}

/** `private.meta_touch_medium`: el utm_medium que llego o, si no, la columna medium. En minusculas. */
function effectiveMedium(touch: TouchForMatch): string | null {
  return trimmed(touch.utmMedium)?.toLowerCase() ?? trimmed(touch.medium)?.toLowerCase() ?? null;
}

/**
 * `private.meta_touch_utm_counts` (00318). `campaign`, `content_label` y `term` cuentan como UTMs si el toque ya trae
 * un id, o si puede traerlos (agenda, formulario, webhook, importado o manual), el medium no es organico y ademas: algun
 * UTM es numerico, la fuente es «meta»/«facebook», o el medium es pago y la fuente puede ser de Meta.
 * «ig»/«instagram» sin un medium pago no alcanza: es el link de la bio o una automatizacion de ManyChat.
 */
function utmCounts(touch: TouchForMatch): boolean {
  if (trimmed(touch.adId) || trimmed(touch.adsetId) || trimmed(touch.campaignId)) return true;
  if (!UTM_ORIGINS.has(touch.origin)) return false;
  const medium = effectiveMedium(touch);
  if (medium && META_ORGANIC_MEDIUMS.includes(medium)) return false;
  if (isNumeric(touch.campaign) || isNumeric(touch.contentLabel) || isNumeric(touch.term)) return true;
  if (STRONG_META_SOURCES.has(trimmed(touch.source)?.toLowerCase() ?? "")) return true;
  return !!medium && META_PAID_MEDIUMS.includes(medium) && isMetaSource(touch.source);
}

/** Lo que del toque va a la resolucion. Un `utm_id` numerico es el id de la campaña. El fbclid solo no dice nada: no va. */
export function touchMetaInput(touch: TouchForMatch): MetaMatchInput {
  const counts = utmCounts(touch);
  const utmId = counts && isMetaSource(touch.source) && isNumeric(touch.utmId) ? trimmed(touch.utmId) : null;
  return {
    adId: touch.adId,
    adsetId: touch.adsetId,
    campaignId: trimmed(touch.campaignId) ?? utmId,
    utmCampaign: counts ? touch.campaign : null,
    utmContent: counts ? touch.contentLabel : null,
    utmTerm: counts ? touch.term : null,
    fbclid: null,
  };
}

/** ¿El toque trae algun dato de Meta? (`private.meta_touch_has_data`) */
export function touchHasMetaData(touch: TouchForMatch): boolean {
  const i = touchMetaInput(touch);
  return [i.adId, i.adsetId, i.campaignId, i.utmCampaign, i.utmContent, i.utmTerm].some((v) => !!trimmed(v));
}

/** Las palabras que no dicen nada de un anuncio (`private.meta_name_tokens`). */
const STOP_WORDS = new Set([
  "ad", "ads", "anuncio", "anuncios", "campana", "campanas", "campaign", "conjunto", "adset", "copia", "copy", "el", "la",
  "los", "las", "de", "del", "y", "e", "en", "un", "una", "a", "al", "con", "por", "para", "the", "of", "and",
]);

/** Las palabras de un nombre: `metaNameKey`, partido por todo lo que no es letra ni numero, sin relleno ni repetidos. */
export function metaNameTokens(raw: string | null | undefined): string[] {
  const words = metaNameKey(raw ?? "").split(/[^a-z0-9]+/).filter((w) => w !== "" && !STOP_WORDS.has(w));
  return [...new Set(words)].sort();
}

/** ¿Alcanzan para buscar un anuncio por parecido? Dos o mas, o un codigo con letras y numeros (n4, s3). */
export function tokensQualify(tokens: string[]): boolean {
  return tokens.length >= 2 || tokens.some((w) => /[a-z]/.test(w) && /[0-9]/.test(w));
}

/** La clave de un valor de UTM para una regla (`private.meta_rule_key`): decodificado, recortado y con `metaNameKey`. */
export function metaRuleKey(raw: string | null | undefined): string {
  const v = trimmed(decodeUtm(raw ?? null));
  return v ? metaNameKey(v) : "";
}

const containsAll = (have: string[], want: string[]) => want.every((w) => have.includes(w));

/** `%XX` y `+` (los UTMs a veces llegan codificados). Un `%XX` que no es UTF-8 valido se deja como llego. */
export function decodeUtm(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const plus = raw.replace(/\+/g, " ");
  if (!plus.includes("%")) return plus;
  try {
    return decodeURIComponent(plus);
  } catch {
    return plus;
  }
}

/** Texto recortado, o null si queda vacio. */
const trimmed = (value: string | null | undefined): string | null => {
  const v = (value ?? "").trim();
  return v === "" ? null : v;
};

const NONE: MetaMatchResult = { status: "none", adId: null, adsetId: null, campaignId: null, method: null, reason: null };

export function resolveMetaMatch(input: MetaMatchInput, catalog: MetaCatalog): MetaMatchResult {
  const adIdIn = trimmed(input.adId);
  const adsetIdIn = trimmed(input.adsetId);
  const campaignIdIn = trimmed(input.campaignId);
  const utmCampaign = trimmed(decodeUtm(input.utmCampaign));
  const utmContent = trimmed(decodeUtm(input.utmContent));
  const utmTerm = trimmed(decodeUtm(input.utmTerm));
  const fbclid = trimmed(input.fbclid);

  if (!adIdIn && !adsetIdIn && !campaignIdIn && !utmCampaign && !utmContent && !utmTerm && !fbclid) {
    return { ...NONE };
  }

  type Ad = MetaCatalog["ads"][number];
  const campaignById = (id: string) => catalog.campaigns.find((c) => c.campaignId === id) ?? null;
  const adById = (id: string) => catalog.ads.find((a) => a.adId === id) ?? null;
  const adsetById = (id: string) => catalog.adsets.find((s) => s.adsetId === id) ?? null;

  // ---- 1. Por id ----
  let hDirect: string | null = null;
  if (campaignIdIn && campaignById(campaignIdIn)) hDirect = campaignIdIn;
  if (!hDirect && utmCampaign && campaignById(utmCampaign)) hDirect = utmCampaign;

  let adId: string | null = null;
  let adAdset: string | null = null;
  let adCampaign: string | null = null;
  let mAd: string | null = null;
  const takeAd = (ad: Ad, method: string) => {
    adId = ad.adId;
    adAdset = ad.adsetId;
    adCampaign = ad.campaignId;
    mAd = method;
  };
  let ambiguousAd = false;
  let ambiguousCampaign = false;

  if (adIdIn) {
    const found = adById(adIdIn);
    if (found) takeAd(found, "ad_id");
  }
  if (!adId && utmContent) {
    const found = adById(utmContent);
    if (found) takeAd(found, "utm_content_id");
  }

  let adset: string | null = null;
  let adsetCampaign: string | null = null;
  let mAdset: string | null = null;
  if (adsetIdIn) {
    const found = adsetById(adsetIdIn);
    if (found) {
      adset = found.adsetId;
      adsetCampaign = found.campaignId;
      mAdset = "adset_id";
    }
  }
  if (!adset && utmTerm) {
    const found = adsetById(utmTerm);
    if (found) {
      adset = found.adsetId;
      adsetCampaign = found.campaignId;
      mAdset = "utm_term_id";
    }
  }

  let hNamed: string | null = null;
  let mNamed: string | null = null;

  // ---- 2. Una regla ----
  if (!adId && (utmCampaign || utmContent || utmTerm)) {
    const ck = utmCampaign ? metaNameKey(utmCampaign) : "";
    const kk = utmContent ? metaNameKey(utmContent) : "";
    const tk = utmTerm ? metaNameKey(utmTerm) : "";
    const rule = (catalog.rules ?? []).find((r) => r.campaignKey === ck && r.contentKey === kk && r.termKey === tk) ?? null;
    if (rule) {
      if (rule.action === "ignore") {
        if (!adset && !hDirect) return { status: "ignored", adId: null, adsetId: null, campaignId: null, method: "rule", reason: null };
      } else if ((!adset || !rule.adsetId || rule.adsetId === adset) && (!hDirect || !rule.campaignId || rule.campaignId === hDirect)) {
        if (rule.adId) {
          adId = rule.adId;
          adAdset = rule.adsetId;
          adCampaign = rule.campaignId;
          mAd = "rule";
        } else if (rule.adsetId && !adset) {
          adset = rule.adsetId;
          adsetCampaign = rule.campaignId;
          mAdset = "rule";
        } else if (rule.campaignId && !hDirect) {
          hNamed = rule.campaignId;
          mNamed = "rule";
        }
      }
    }
  }

  // ---- 3. Anuncio por nombre exacto, adentro de lo conocido por id ----
  if (!adId && utmContent && (adset || hDirect)) {
    const key = metaNameKey(utmContent);
    const named = key === "" ? [] : catalog.ads.filter((a) => a.nameKey === key && (adset ? a.adsetId === adset : a.campaignId === hDirect));
    if (named.length === 1) takeAd(named[0], adset ? "utm_content_name_adset" : "utm_content_name_campaign");
    else if (named.length > 1) ambiguousAd = true;
  }

  // ---- 4. Sin ningun id: la campaña por su nombre (unico) o, si no, por parecido ----
  let scope: string[] = [];
  if (!adId && !adset && !hDirect && !hNamed && utmCampaign && !isNumeric(utmCampaign)) {
    const key = metaNameKey(utmCampaign);
    if (key !== "") {
      const named = catalog.campaigns.filter((c) => c.nameKey === key);
      if (named.length === 1) {
        hNamed = named[0].campaignId;
        mNamed = "utm_campaign_name";
      } else if (named.length > 1) {
        ambiguousCampaign = true;
      }
    }
    if (!hNamed) {
      const tokens = metaNameTokens(utmCampaign);
      if (tokens.length > 0) {
        scope = catalog.campaigns
          .filter((c) => containsAll(metaNameTokens(c.nameKey), tokens))
          .map((c) => c.campaignId)
          .sort();
        if (scope.length === 1) {
          hNamed = scope[0];
          mNamed = "utm_campaign_similar";
        } else if (scope.length > 1) {
          ambiguousCampaign = true;
        }
      }
    }
  }

  // ---- 5. Anuncio por nombre exacto dentro de la campaña hallada por su nombre ----
  if (!adId && !adIdIn && mNamed === "utm_campaign_name" && utmContent) {
    const key = metaNameKey(utmContent);
    const named = key === "" ? [] : catalog.ads.filter((a) => a.campaignId === hNamed && a.nameKey === key);
    if (named.length === 1) takeAd(named[0], "utm_content_name");
    else if (named.length > 1) ambiguousAd = true;
  }

  // ---- 6. Anuncio por parecido ----
  if (!adId && !adIdIn && !ambiguousAd && utmContent && !isNumeric(utmContent)) {
    const tokens = metaNameTokens(utmContent);
    let candidates: Ad[] = [];
    if (tokensQualify(tokens)) {
      const similar = (a: Ad) => containsAll(metaNameTokens(a.nameKey), tokens);
      if (adset) {
        candidates = catalog.ads.filter((a) => a.adsetId === adset && similar(a));
        if (candidates.length === 1) takeAd(candidates[0], "utm_content_similar_adset");
      } else if (hDirect ?? hNamed ?? scope.length > 1) {
        const campaigns = hDirect ?? hNamed ? [(hDirect ?? hNamed) as string] : scope;
        candidates = catalog.ads.filter((a) => a.campaignId !== null && campaigns.includes(a.campaignId) && similar(a));
        if (candidates.length === 1) takeAd(candidates[0], "utm_content_similar_campaign");
      }
    }
    if (candidates.length > 1) ambiguousAd = true;
  }

  // ---- 7. El unico anuncio del conjunto. No si llego un id de anuncio que no esta en el catalogo: seria otro anuncio. ----
  if (!adId && adset && !ambiguousAd && !adIdIn && !isNumeric(utmContent)) {
    const inAdset = catalog.ads.filter((a) => a.adsetId === adset);
    if (inAdset.length === 1) takeAd(inAdset[0], "adset_single_ad");
  }

  // ---- El conjunto del anuncio ----
  if (!adset && adId && adAdset) {
    adset = adAdset;
    mAdset = mAd;
    adsetCampaign = adsetById(adAdset)?.campaignId ?? null;
  }

  // ---- Campaña ----
  let campaign: string | null = null;
  let mCampaign: string | null = null;
  const notes: string[] = [];

  if (hDirect) {
    campaign = hDirect;
    mCampaign = campaignIdIn && hDirect === campaignIdIn ? "campaign_id" : "utm_campaign_id";
    // Coherencia: si el anuncio es de OTRA campaña, gana el anuncio (es mas especifico).
    if (adId && adCampaign && adCampaign !== campaign) {
      campaign = adCampaign;
      mCampaign = mAd;
      notes.push("inconsistent_campaign");
    }
  } else if (adCampaign || adsetCampaign) {
    campaign = adCampaign ?? adsetCampaign;
    mCampaign = adCampaign ? mAd : mAdset;
  } else if (hNamed) {
    campaign = hNamed;
    mCampaign = mNamed;
  }

  // ---- Resultado ----
  if (adId || adset || campaign) {
    if (ambiguousAd) notes.push("ambiguous_ad_name");
    if ((adIdIn && !adId) || (adsetIdIn && mAdset !== "adset_id") || (campaignIdIn && hDirect !== campaignIdIn && campaign !== campaignIdIn)) {
      notes.push("id_not_in_catalog");
    }
    return {
      status: "matched",
      adId,
      adsetId: adset,
      campaignId: campaign,
      method: mAd ?? mAdset ?? mCampaign,
      reason: notes.length > 0 ? notes.join(",") : null,
    };
  }

  let reason: string;
  if (adIdIn || adsetIdIn || campaignIdIn) reason = "id_not_in_catalog";
  else if (ambiguousAd) reason = "ambiguous_ad_name";
  else if (ambiguousCampaign) reason = "ambiguous_campaign_name";
  else if (utmCampaign && !isNumeric(utmCampaign)) reason = "name_not_found";
  else if (utmCampaign || utmContent || utmTerm) reason = "name_without_id";
  else reason = "fbclid_only";

  return { status: "unmatched", adId: null, adsetId: null, campaignId: null, method: null, reason };
}
