// @plantilla-quitar(ventas)
/**
 * El destino del link con código (F73): la URL del link con `?ref=<código>` y las UTM del afiliado, sin pisar los
 * parámetros que el link ya tenía. Puro.
 */
export function buildAffiliateUrl(linkUrl: string, code: string, productSlug: string, linkKey: string): string {
  const u = new URL(linkUrl);
  const set = (k: string, v: string) => {
    if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  };
  set("ref", code);
  set("utm_source", "afiliado");
  set("utm_medium", "referral");
  set("utm_campaign", productSlug);
  set("utm_content", linkKey);
  return u.toString();
}

/** El link corto que se comparte: `/r/<código>/<linkKey>` en el dominio de los links del negocio. */
export function shortAffiliateUrl(base: string, code: string, linkKey: string): string {
  return `${base.replace(/\/+$/, "")}/r/${encodeURIComponent(code)}/${encodeURIComponent(linkKey)}`;
}

/** Un link de agenda o formulario «con mi código»: agrega `?ref=` (sin pisar uno que ya tenga). */
export function withRef(url: string, code: string): string {
  const u = new URL(url);
  if (!u.searchParams.has("ref")) u.searchParams.set("ref", code);
  return u.toString();
}

/** El nombre del producto como texto de campaña: minúsculas, sin acentos, con guiones. */
export function campaignSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const AFFILIATE_CODE = /^[a-z0-9]{4,24}$/;
