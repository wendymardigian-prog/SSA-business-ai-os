/**
 * Las claves de atribución de una visita: la ÚNICA lista (decisión 185).
 *
 * Es un superconjunto de las cinco UTM y los cuatro ids de clic con los que
 * nació la Agenda. Desde el Extra L (F16) la Agenda también lee de acá las
 * claves de más (`utm_id`, `ad_id`, `adset_id`, `campaign_id`, `gbraid`…): SUMAR
 * claves no rompe ninguna URL de embed ya publicada, porque las viejas siguen
 * siendo un subconjunto. Un test (`keys.test.ts`) verifica que esta lista las
 * contiene a todas.
 *
 * Módulo PURO y sin dependencias: lo importa también el script de embed, que se
 * compila aparte para la página de cualquiera.
 */

export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
] as const;

/** Un id de clic por plataforma de anuncios. */
export const CLICK_ID_KEYS = [
  "fbclid", // Meta
  "gclid", // Google
  "gbraid", // Google (iOS)
  "wbraid", // Google (web a app)
  "msclkid", // Microsoft
  "ttclid", // TikTok
  "li_fat_id", // LinkedIn
  "twclid", // X
  "sccid", // Snapchat (también llega como ScCid)
  "epik", // Pinterest
  "rdt_cid", // Reddit
] as const;

export const AD_KEYS = ["ad_id", "adset_id", "campaign_id", "placement"] as const;

/**
 * Cookies de los anuncios. Las lee el navegador, nunca la URL.
 * La clave es el nombre de la cookie; el valor, como se guarda.
 */
export const COOKIE_KEYS = {
  _fbp: "fbp",
  _fbc: "fbc",
  _ga: "ga_client_id",
} as const;
export const COOKIE_VALUE_KEYS = ["fbp", "fbc", "ga_client_id"] as const;

/** Variantes de mayúsculas que algunas plataformas mandan tal cual. */
export const KEY_ALIASES: Record<string, string> = {
  scclid: "sccid",
};

/** Claves que, si vienen en la URL, hacen de la visita un toque NUEVO. */
export const TOUCH_KEYS: readonly string[] = [...UTM_KEYS, ...CLICK_ID_KEYS, ...AD_KEYS];

/** Todas las claves de atribución que se guardan tal cual (URL o cookie). */
export const ATTRIBUTION_KEYS: readonly string[] = [...TOUCH_KEYS, ...COOKIE_VALUE_KEYS];

/** Datos de la visita que no son claves de URL pero se guardan junto a ellas. */
export const VISIT_META_KEYS = ["referrer_url", "landing_page", "page_url"] as const;

export const MAX_VALUE_LENGTH = 200;

export function isAttributionKey(key: string): boolean {
  return ATTRIBUTION_KEYS.includes(key);
}

/** Lleva una clave de URL a su nombre canónico (`ScCid` → `sccid`) o null si no es de atribución. */
export function canonicalKey(key: string): string | null {
  const lower = key.toLowerCase();
  const canonical = KEY_ALIASES[lower] ?? lower;
  return ATTRIBUTION_KEYS.includes(canonical) ? canonical : null;
}
