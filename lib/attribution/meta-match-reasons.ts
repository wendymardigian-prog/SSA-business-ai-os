/**
 * Los motivos del vinculo con Meta, dichos en palabras (Extra L, AT3, F29).
 *
 * `resolve_meta_match` deja un codigo en `meta_match_reason` (`id_not_in_catalog`, ...) y un metodo en
 * `meta_match_method` (`utm_content_name`, ...). La pantalla «Sin vincular» y la ficha del contacto los
 * muestran con estas frases, que dicen QUE paso y, cuando se puede, QUE hacer.
 *
 * Modulo puro: lo que depende de los datos (el id, cuantos anuncios hay con ese nombre) viene en `ctx`.
 */

export interface ReasonContext {
  adId?: string | null;
  adsetId?: string | null;
  campaignId?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  /** Cuantos anuncios (o campañas) comparten el nombre, si se sabe. */
  count?: number | null;
}

const quote = (value: string) => `«${value}»`;

/** El id que vino en el toque, el mas especifico. */
function givenId(ctx: ReasonContext): { label: string; id: string } | null {
  if (ctx.adId) return { label: "El anuncio", id: ctx.adId };
  if (ctx.adsetId) return { label: "El conjunto", id: ctx.adsetId };
  if (ctx.campaignId) return { label: "La campaña", id: ctx.campaignId };
  return null;
}

/** Una frase para un codigo de motivo. Un codigo que no se conoce se dice tal cual (no se inventa nada). */
export function describeMatchReason(code: string, ctx: ReasonContext = {}): string {
  switch (code) {
    case "id_not_in_catalog": {
      const given = givenId(ctx);
      return given
        ? `${given.label} ${given.id} no está en la cuenta: puede ser de otra cuenta o muy nuevo (se vuelve a intentar en cada sincronización).`
        : "El id que trae no está en la cuenta: puede ser de otra cuenta o muy nuevo (se vuelve a intentar en cada sincronización).";
    }
    case "ambiguous_ad_name": {
      const name = ctx.utmContent ? ` ${quote(ctx.utmContent)}` : "";
      const many = ctx.count && ctx.count > 1 ? `Hay ${ctx.count} anuncios` : "Hay varios anuncios";
      return `${many} con el nombre${name}, y la campaña no alcanza para saber cuál fue. Elegilo a mano.`;
    }
    case "ambiguous_campaign_name": {
      const name = ctx.utmCampaign ? ` ${quote(ctx.utmCampaign)}` : "";
      const many = ctx.count && ctx.count > 1 ? `Hay ${ctx.count} campañas` : "Hay varias campañas";
      return `${many} con el nombre${name}. Elegila a mano.`;
    }
    case "name_not_found": {
      const name = ctx.utmContent ?? ctx.utmCampaign;
      return name
        ? `El nombre ${quote(name)} no coincide con ningún anuncio ni campaña del catálogo.`
        : "Lo que trae no coincide con ningún anuncio ni campaña del catálogo.";
    }
    case "fbclid_only":
      return "Solo trae el id de clic de Facebook: no alcanza para saber el anuncio.";
    case "inconsistent_campaign":
      return "El anuncio es de otra campaña que la indicada: se usó la campaña del anuncio.";
    default:
      return code;
  }
}

/** Los motivos de un toque (puede haber varios, separados por coma), cada uno en palabras. */
export function describeMatchReasons(reason: string | null | undefined, ctx: ReasonContext = {}): string[] {
  if (!reason) return [];
  return reason
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)
    .map((code) => describeMatchReason(code, ctx));
}

/** Como se hallo el anuncio, en palabras (para la ficha del contacto). */
export function describeMatchMethod(method: string | null | undefined): string | null {
  switch (method) {
    case "ad_id":
      return "por el id del anuncio";
    case "utm_content_id":
      return "por el contenido del enlace (era el id del anuncio)";
    case "utm_content_name":
      return "por el nombre del anuncio";
    case "utm_content_name_campaign":
      return "por el nombre del anuncio y su campaña";
    case "adset_id":
      return "por el id del conjunto";
    case "utm_term_id":
      return "por el término del enlace (era el id del conjunto)";
    case "campaign_id":
      return "por el id de la campaña";
    case "utm_campaign_id":
      return "por la campaña del enlace (era su id)";
    case "utm_campaign_name":
      return "por el nombre de la campaña";
    case "manual":
      return "a mano";
    default:
      return null;
  }
}
