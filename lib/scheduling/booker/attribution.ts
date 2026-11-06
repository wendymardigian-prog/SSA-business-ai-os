/**
 * La atribución efectiva de una reserva (Extra L, F16): de dónde vino la persona que agenda.
 *
 * Misma regla que el formulario público (`components/forms/public/public-form.tsx`), para que una reserva y
 * un formulario cuenten la misma historia:
 *   - si la URL trae un toque NUEVO (UTM, un id de clic o de anuncio), gana la URL;
 *   - si no, vale el ÚLTIMO toque guardado: la cookie `ssa_attr` en las páginas propias; en un embed, lo que
 *     mandó el script de la web anfitriona en `attr` (su URL, su `localStorage` y sus cookies de anuncios);
 *   - las cookies de anuncios (`_fbp`, `_fbc`, `_ga`) y la primera visita se suman siempre.
 * El servidor la vuelve a sanear (`pickUtm`): no se confía en el navegador.
 *
 * PURO: recibe lo que lee el navegador; no toca `window` ni `document`.
 */
import { attributionFromParams, gaClientId, parseCookieHeader, sanitizeAttribution } from "@/lib/attribution/collect";
import { effectiveAttribution, preferEmbeddedEntryUrl, preferEmbeddedReferrer } from "@/lib/attribution/merge";
import { storedFromEffective } from "@/lib/attribution/browser";
import { parseStored } from "@/lib/attribution/store";
import { COOKIE_KEYS } from "@/lib/attribution/keys";
import { decodeAttr } from "@/lib/attribution/embed-attr";

export interface BookingAttributionInput {
  /** Los parámetros de la URL de la página (o del iframe) tal cual. */
  params: URLSearchParams | Record<string, string | undefined>;
  isEmbed: boolean;
  /** `document.referrer`. */
  referrer: string;
  /** `window.location.href`. */
  href: string;
  /** `document.cookie`. */
  cookieHeader: string;
  /** El valor crudo de la cookie `ssa_attr` (páginas propias). */
  storedCookie: string | null;
  /** La página de la web anfitriona (el embed la manda como `referrer`). */
  hostPageUrl: string | null;
  /** Lo que mandó el script del embed (`attr`), todavía codificado. */
  attrParam: string | null;
}

export function bookingAttribution(input: BookingAttributionInput): Record<string, unknown> {
  try {
    const parentUrl = input.isEmbed ? input.hostPageUrl ?? undefined : undefined;
    const current = attributionFromParams(input.params, {
      referrer: parentUrl ?? input.referrer,
      landing: parentUrl ?? input.href,
      pageUrl: parentUrl ?? input.href,
      cookies: parseCookieHeader(input.cookieHeader),
    });
    if (input.isEmbed) {
      const fromEmbed = sanitizeAttribution(decodeAttr(input.attrParam));
      return preferEmbeddedReferrer(preferEmbeddedEntryUrl(effectiveAttribution(current, storedFromEffective(fromEmbed)), fromEmbed), fromEmbed);
    }
    return effectiveAttribution(current, parseStored(input.storedCookie));
  } catch {
    return {};
  }
}

/**
 * Lo que se guarda en `bookings.utm`: lo que deja `pickUtm` más la página de llegada y la del envío, saneadas. Van en el
 * mismo jsonb para no tocar `create_booking`, que ya lo guarda tal cual. Sin esto, si falla el toque se pierden.
 */
export function bookingUtmPayload(pickedUtm: Record<string, unknown>, raw: Record<string, unknown>, landingPage: unknown): Record<string, unknown> {
  const pages = sanitizeAttribution({ landing_page: landingPage ?? raw.landing_page, page_url: raw.page_url });
  return {
    ...pickedUtm,
    ...(pages.landing_page ? { landing_page: pages.landing_page } : {}),
    ...(pages.page_url ? { page_url: pages.page_url } : {}),
  };
}

/**
 * Las cookies de anuncios que el pedido trae y el navegador no mandó (`_fbp`, `_fbc`, `_ga`): se completan en
 * el servidor. Una clave que ya vino no se pisa.
 */
export function fillFromRequestCookies(attribution: Record<string, unknown>, cookieHeader: string | null | undefined): Record<string, unknown> {
  const cookies = parseCookieHeader(cookieHeader);
  const out = { ...attribution };
  for (const [cookie, key] of Object.entries(COOKIE_KEYS)) {
    // `_ga` ("GA1.2.111.222") se reduce al client id ("111.222"), como en el resto de la atribucion.
    const value = cookie === "_ga" ? gaClientId(cookies[cookie]) : cookies[cookie];
    if (value && !out[key]) out[key] = value.slice(0, 200);
  }
  return out;
}
