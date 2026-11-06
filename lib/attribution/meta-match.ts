/**
 * La gemela en TypeScript de `public.resolve_meta_match` (migraciones 00192 y 00299).
 *
 * Resuelve los datos de un toque (ids de Meta, UTMs, fbclid) contra el catalogo de Meta y dice
 * a que anuncio, conjunto y campaña corresponde, con el metodo y, si no se pudo, el motivo.
 *
 * Existe para dos cosas: la pantalla «Sin vincular» (mostrar el motivo en palabras) y los
 * tests. **Tiene que dar EXACTAMENTE lo mismo que la funcion SQL**: los mismos casos
 * (`meta-match.cases.json`) corren contra las dos, en Vitest y en `verify-ads-attribution.mjs`
 * (el mismo patron que `derive_sale_status`). Si se cambia una regla, se cambia en las dos y
 * se suma el caso.
 *
 * Regla (00299): SIEMPRE por id. Dos campañas o dos anuncios pueden llamarse igual, asi que un nombre
 * solo sirve adentro de algo que ya se conoce por id.
 *   Campaña:  campaign_id -> utm_campaign igual a un campaign_id -> la del anuncio o del conjunto. Nunca por nombre.
 *   Conjunto: adset_id -> utm_term igual a un adset_id -> el del anuncio. Nunca por nombre.
 *   Anuncio:  ad_id -> utm_content igual a un ad_id -> utm_content como nombre, solo si es unico dentro del
 *             conjunto (o, si no hay conjunto, de la campaña) conocido por id -> el unico anuncio del conjunto.
 *   Coherencia: si el anuncio es de otra campaña que la hallada directo, gana el anuncio y
 *             se anota `inconsistent_campaign`.
 *
 * Modulo puro: no sabe de Supabase.
 */

import { metaNameKey } from "@/lib/meta/name-key";

export interface MetaCatalog {
  campaigns: Array<{ campaignId: string; nameKey: string }>;
  adsets: Array<{ adsetId: string; campaignId: string | null }>;
  ads: Array<{ adId: string; adsetId: string | null; campaignId: string | null; nameKey: string }>;
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

export type MetaMatchStatus = "none" | "matched" | "unmatched";

export interface MetaMatchResult {
  status: MetaMatchStatus;
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
  method: string | null;
  reason: string | null;
}

/** Lo que de un toque hace falta para saber si trae datos de Meta (columnas de `contact_touches`). */
export interface TouchForMatch {
  origin: string;
  adId?: string | null;
  adsetId?: string | null;
  campaignId?: string | null;
  /** `utm_source`, en minusculas. Sin fuente cuenta como generica. */
  source?: string | null;
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

/** Las fuentes que pueden traer un anuncio de Meta, y las genericas de un toque sin `utm_source`. */
const META_SOURCES = new Set(["meta", "facebook", "fb", "instagram", "ig", "msg", "an", "web"]);
const isMetaSource = (source: string | null | undefined) => {
  const v = trimmed(source)?.toLowerCase();
  return !v || META_SOURCES.has(v);
};
const isNumeric = (value: string | null | undefined) => /^\d+$/.test(trimmed(value) ?? "");

/** El `utm_id` de un toque: un formulario lo guarda en `raw.utm_id`; una reunion, en `raw.utm.utm_id`. */
export function touchUtmId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { utm_id?: unknown; utm?: { utm_id?: unknown } | null };
  const value = r.utm_id ?? r.utm?.utm_id;
  return typeof value === "string" ? trimmed(value) : null;
}

/**
 * `private.meta_touch_utm_counts` (00194 y 00299). `campaign`, `content_label` y `term` cuentan como UTMs si el toque
 * ya trae un id de anuncio, o si puede traerlos (agenda, formulario, webhook, importado o manual) y ademas su fuente
 * es de Meta o alguno es un id: un `utm_source=whatsapp&utm_campaign=grupo` no es de Meta y no tiene nada que revisar.
 */
function utmCounts(touch: TouchForMatch): boolean {
  if (trimmed(touch.adId) || trimmed(touch.adsetId) || trimmed(touch.campaignId)) return true;
  if (!UTM_ORIGINS.has(touch.origin)) return false;
  return isMetaSource(touch.source) || isNumeric(touch.campaign) || isNumeric(touch.contentLabel) || isNumeric(touch.term);
}

/** Lo que del toque va a la resolucion. Los ids y el fbclid siempre cuentan; un `utm_id` numerico es el id de la campaña. */
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
    fbclid: touch.fbclid,
  };
}

/** ¿El toque trae algun dato de Meta? (`private.meta_touch_has_data`) */
export function touchHasMetaData(touch: TouchForMatch): boolean {
  const i = touchMetaInput(touch);
  return [i.adId, i.adsetId, i.campaignId, i.utmCampaign, i.utmContent, i.utmTerm, i.fbclid].some((v) => !!trimmed(v));
}

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

  const campaignById = (id: string) => catalog.campaigns.find((c) => c.campaignId === id) ?? null;
  const adById = (id: string) => catalog.ads.find((a) => a.adId === id) ?? null;
  const adsetById = (id: string) => catalog.adsets.find((s) => s.adsetId === id) ?? null;

  // ---- La campaña por id ----
  let hDirect: string | null = null;
  if (campaignIdIn && campaignById(campaignIdIn)) hDirect = campaignIdIn;
  if (!hDirect && utmCampaign && campaignById(utmCampaign)) hDirect = utmCampaign;

  // ---- Anuncio por id ----
  let ad: (typeof catalog.ads)[number] | null = null;
  let mAd: string | null = null;
  let ambiguousAd = false;

  if (adIdIn) {
    ad = adById(adIdIn);
    if (ad) mAd = "ad_id";
  }
  if (!ad && utmContent) {
    ad = adById(utmContent);
    if (ad) mAd = "utm_content_id";
  }

  // ---- Conjunto por id ----
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

  // ---- Anuncio por nombre: solo adentro de lo que ya se conoce por id ----
  if (!ad && utmContent) {
    const key = metaNameKey(utmContent);
    const scope = adset ? catalog.ads.filter((a) => a.adsetId === adset) : hDirect ? catalog.ads.filter((a) => a.campaignId === hDirect) : [];
    const named = key === "" ? [] : scope.filter((a) => a.nameKey === key);
    if (named.length === 1) {
      ad = named[0];
      mAd = adset ? "utm_content_name_adset" : "utm_content_name_campaign";
    } else if (named.length > 1) {
      ambiguousAd = true;
    }
  }

  // ---- El unico anuncio del conjunto. No si llego un id de anuncio que no esta en el catalogo: seria otro anuncio. ----
  if (!ad && adset && !ambiguousAd && !adIdIn && !isNumeric(utmContent)) {
    const inAdset = catalog.ads.filter((a) => a.adsetId === adset);
    if (inAdset.length === 1) {
      ad = inAdset[0];
      mAd = "adset_single_ad";
    }
  }

  // ---- El conjunto del anuncio ----
  if (!adset && ad && ad.adsetId) {
    adset = ad.adsetId;
    mAdset = mAd;
    adsetCampaign = adsetById(adset)?.campaignId ?? null;
  }

  // ---- Campaña ----
  let campaign: string | null = null;
  let mCampaign: string | null = null;
  const notes: string[] = [];
  const adCampaign = ad?.campaignId ?? null;

  if (hDirect) {
    campaign = hDirect;
    mCampaign = campaignIdIn && hDirect === campaignIdIn ? "campaign_id" : "utm_campaign_id";
    // Coherencia: si el anuncio es de OTRA campaña, gana el anuncio (es mas especifico).
    if (ad && adCampaign && adCampaign !== campaign) {
      campaign = adCampaign;
      mCampaign = mAd;
      notes.push("inconsistent_campaign");
    }
  } else if (adCampaign || adsetCampaign) {
    campaign = adCampaign ?? adsetCampaign;
    mCampaign = adCampaign ? mAd : mAdset;
  }

  // ---- Resultado ----
  if (ad || adset || campaign) {
    if (ambiguousAd) notes.push("ambiguous_ad_name");
    // Un id que vino y no esta en el catalogo, aunque otra pista haya resuelto algo.
    if (
      (adIdIn && !ad) ||
      (adsetIdIn && mAdset !== "adset_id") ||
      (campaignIdIn && hDirect !== campaignIdIn && campaign !== campaignIdIn)
    ) {
      notes.push("id_not_in_catalog");
    }
    return {
      status: "matched",
      adId: ad?.adId ?? null,
      adsetId: adset,
      campaignId: campaign,
      method: mAd ?? mAdset ?? mCampaign,
      reason: notes.length > 0 ? notes.join(",") : null,
    };
  }

  let reason: string;
  if (adIdIn || adsetIdIn || campaignIdIn) reason = "id_not_in_catalog";
  else if (utmCampaign || utmContent || utmTerm) reason = "name_without_id";
  else reason = "fbclid_only";

  return { status: "unmatched", adId: null, adsetId: null, campaignId: null, method: null, reason };
}
