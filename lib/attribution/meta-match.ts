/**
 * La gemela en TypeScript de `public.resolve_meta_match` (migracion 00192, Extra L, AT3).
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
 * Orden (decisiones #264 a #266):
 *   Anuncio:  ad_id exacto -> utm_content igual a un ad_id -> utm_content como nombre
 *             (varios: se desempata con la campaña; si siguen varios, NO se vincula el anuncio).
 *   Conjunto: adset_id -> utm_term igual a un adset_id -> el del anuncio.
 *   Campaña:  campaign_id -> utm_campaign igual a un campaign_id -> la del anuncio o del conjunto
 *             -> utm_campaign como nombre (varias: ambiguous_campaign_name).
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
  /** UTM campaign. */
  campaign?: string | null;
  /** UTM content: en un comentario o un DM organico es el TITULO de la publicacion, no un UTM. */
  contentLabel?: string | null;
  term?: string | null;
  fbclid?: string | null;
}

/** Los origenes de un toque que pueden traer UTMs de verdad. */
const UTM_ORIGINS = new Set(["booking", "form", "webhook", "import", "manual"]);

/**
 * La regla de la migracion 00194 (`private.meta_touch_utm_counts`): `campaign`, `content_label` y `term`
 * cuentan como UTMs solo si el toque puede traerlos (agenda, formulario, webhook, importado o manual) o
 * si ya trae algun id de anuncio (un DM de un anuncio: el titulo del anuncio sirve para el nombre).
 * Los ids y el fbclid siempre cuentan.
 */
export function touchMetaInput(touch: TouchForMatch): MetaMatchInput {
  const hasAdId = !!trimmed(touch.adId) || !!trimmed(touch.adsetId) || !!trimmed(touch.campaignId);
  const utmCounts = UTM_ORIGINS.has(touch.origin) || hasAdId;
  return {
    adId: touch.adId,
    adsetId: touch.adsetId,
    campaignId: touch.campaignId,
    utmCampaign: utmCounts ? touch.campaign : null,
    utmContent: utmCounts ? touch.contentLabel : null,
    utmTerm: utmCounts ? touch.term : null,
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

  // ---- La campaña que se puede deducir SIN pasar por el anuncio (pistas 1, 2 y 4) ----
  let hCampaign: string | null = null;
  let hDirect: string | null = null;
  let ambiguousCampaign = false;

  if (campaignIdIn && campaignById(campaignIdIn)) {
    hCampaign = campaignIdIn;
    hDirect = hCampaign;
  }
  if (!hCampaign && utmCampaign && campaignById(utmCampaign)) {
    hCampaign = utmCampaign;
    hDirect = hCampaign;
  }
  if (!hCampaign && utmCampaign) {
    const key = metaNameKey(utmCampaign);
    const named = key === "" ? [] : [...new Set(catalog.campaigns.filter((c) => c.nameKey === key).map((c) => c.campaignId))];
    if (named.length === 1) hCampaign = named[0];
    else if (named.length > 1) ambiguousCampaign = true;
  }

  // ---- Anuncio ----
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
  if (!ad && utmContent) {
    const key = metaNameKey(utmContent);
    if (key !== "") {
      const named = catalog.ads.filter((a) => a.nameKey === key);
      if (named.length === 1) {
        ad = named[0];
        mAd = "utm_content_name";
      } else if (named.length > 1) {
        if (hCampaign) {
          const inCampaign = named.filter((a) => a.campaignId === hCampaign);
          if (inCampaign.length === 1) {
            ad = inCampaign[0];
            mAd = "utm_content_name_campaign";
          }
        }
        if (!ad) ambiguousAd = true;
      }
    }
  }

  // ---- Conjunto ----
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
  } else if (hCampaign) {
    campaign = hCampaign;
    mCampaign = "utm_campaign_name";
  }

  // ---- Resultado ----
  if (ad || adset || campaign) {
    if (ambiguousAd) notes.push("ambiguous_ad_name");
    if (ambiguousCampaign && !campaign) notes.push("ambiguous_campaign_name");
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
  else if (ambiguousAd) reason = "ambiguous_ad_name";
  else if (ambiguousCampaign) reason = "ambiguous_campaign_name";
  else if (utmCampaign || utmContent || utmTerm) reason = "name_not_found";
  else reason = "fbclid_only";

  return { status: "unmatched", adId: null, adsetId: null, campaignId: null, method: null, reason };
}
