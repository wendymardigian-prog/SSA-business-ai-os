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
import { effectiveAttribution, preferEmbeddedEntryUrl } from "@/lib/attribution/merge";
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
      return preferEmbeddedEntryUrl(effectiveAttribution(current, storedFromEffective(fromEmbed)), fromEmbed);
    }
    return effectiveAttribution(current, parseStored(input.storedCookie));
  } catch {
    return {};
  }
}

/**
 * Las cookies de anuncios que el pedido trae y el navegador no mandó (`_fbp`, `_fbc`, `_ga`): se completan en
 * el servidor, igual que `buildAttribution` de Formularios. Una clave que ya vino no se pisa.
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
