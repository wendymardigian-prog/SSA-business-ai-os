/**
 * La atribución EFECTIVA de un envío (F6, decisión 185).
 *
 * Si la URL actual trae UTM, un id de clic o de anuncio, esa visita es un toque
 * NUEVO y gana. Si no trae nada, se usa el ÚLTIMO toque persistido (la cookie
 * `ssa_attr` o el `localStorage` de la web que embebe), con su página de
 * llegada y su referrer. Las cookies de anuncios y la página actual se suman
 * siempre, y la primera visita persistida viaja aparte en `first_visit`.
 *
 * PURA y sin dependencias.
 */
import { COOKIE_VALUE_KEYS } from "./keys";
import { hasTouchKeys } from "./collect";
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
