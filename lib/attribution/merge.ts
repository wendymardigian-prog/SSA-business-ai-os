/**
 * La atribución EFECTIVA de un envío (F6, decisión 185).
 *
 * Si la URL actual trae UTM, un id de clic o de anuncio, esa visita es un toque
 * NUEVO y gana. Si no trae nada, se usa el ÚLTIMO toque persistido (la cookie
 * `ssa_attr` o el `localStorage` de la web que embebe), con su página de
 * llegada y su referrer.
 *
 * La URL de entrada completa (`entry_url`, plano formularios-ui F17) sigue la
 * misma regla: con toque nuevo, la de esta visita; sin toque, la de la visita
 * guardada ("por donde entro"); y si no hay ninguna guardada, la de la pagina.
 *
 * Las cookies de anuncios y la página actual se suman siempre, y la primera
 * visita persistida viaja aparte en `first_visit`.
 *
 * PURA y sin dependencias.
 */
import { COOKIE_VALUE_KEYS } from "./keys";
import { hasTouchKeys } from "./collect";
import { ENTRY_URL_KEY } from "./entry-url";
import type { Attribution, StoredAttribution, Visit } from "./types";

/** Una visita sin su sello de tiempo: queda como objeto plano de texto. */
function visitToAttribution(visit: Visit | undefined): Attribution {
  const out: Attribution = {};
  if (!visit) return out;
  for (const [key, value] of Object.entries(visit)) {
    if (key === "ts") continue;
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  return out;
}

export type EffectiveResult = Attribution & { first_visit?: Visit };

export function effectiveAttribution(
  current: Attribution | null | undefined,
  stored: StoredAttribution | null | undefined,
): EffectiveResult {
  const now: Attribution = { ...(current ?? {}) };
  const last = visitToAttribution(stored?.last);

  let base: Attribution;
  if (hasTouchKeys(now)) {
    base = { ...now };
  } else {
    // Sin toque nuevo: manda el último persistido; de la visita actual quedan la
    // página del formulario y las cookies.
    base = { ...last };
    if (now.page_url) base.page_url = now.page_url;
    // Si la visita actual no trae referrer ni página de llegada propios, no pisan a los guardados.
  }

  // Una visita guardada de antes de esta funcion no trae `entry_url`: ahi vale la de la pagina.
  if (!base[ENTRY_URL_KEY] && now[ENTRY_URL_KEY]) base[ENTRY_URL_KEY] = now[ENTRY_URL_KEY];

  for (const key of COOKIE_VALUE_KEYS) {
    const fresh = now[key];
    if (fresh) base[key] = fresh;
    else if (!base[key] && last[key]) base[key] = last[key];
  }
  if (now.page_url) base.page_url = now.page_url;

  const result: EffectiveResult = base;
  if (stored?.first) result.first_visit = stored.first;
  return result;
}

/**
 * En un embed, la pagina madre manda su URL de entrada ENTERA dentro de `attr`, y al iframe le llega
 * ademas como `referrer` pero cortada a 500 caracteres. La entera gana: sin esto, una URL larga de
 * Meta (con `ad_name`, `campaign_name`...) quedaria cortada a la mitad. `fromEmbed` ya viene saneado.
 */
export function preferEmbeddedEntryUrl<T extends Attribution>(result: T, fromEmbed: Record<string, unknown> | null | undefined): T {
  const entry = fromEmbed?.[ENTRY_URL_KEY];
  return typeof entry === "string" && entry !== "" ? { ...result, [ENTRY_URL_KEY]: entry } : result;
}
