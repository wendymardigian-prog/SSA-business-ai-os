/**
 * Lo que cambia cuando un formulario se envía desde una página del sitio (F31). PURO.
 *
 * El envío va por el MISMO camino que `/f/<slug>` (`submitForm`): lo único propio del
 * sitio es de dónde vino (`origin = "site"`) y en qué ruta estaba (`site_path`), más la
 * atribución EFECTIVA de la visita (la URL actual si trae un toque nuevo; si no, la
 * cookie `ssa_attr`), que arma `PublicForm` con las funciones de `lib/attribution`.
 */

export const SITE_PATH_MAX = 300;

/** La ruta de la página, sin query ni hash y sin dobles barras. `null` si no sirve. */
export function normalizeSitePath(pathname: string | null | undefined): string | null {
  if (typeof pathname !== "string") return null;
  const clean = pathname.split(/[?#]/)[0].replace(/\/{2,}/g, "/").trim();
  if (!clean.startsWith("/")) return null;
  const path = clean.length > 1 ? clean.replace(/\/$/, "") : clean;
  return path.slice(0, SITE_PATH_MAX);
}

export interface SubmitOriginFields {
  origin: "public_page" | "embed" | "site";
  site_path?: string;
}

/** `origin` y `site_path` del pedido, según dónde está el formulario. `site_path` solo viaja en el modo `site`. */
export function submitOriginFields(mode: "public_page" | "embed" | "site", pathname?: string | null): SubmitOriginFields {
  if (mode !== "site") return { origin: mode };
  const sitePath = normalizeSitePath(pathname);
  return sitePath ? { origin: "site", site_path: sitePath } : { origin: "site" };
}

/** Los parámetros de la URL de la página como mapa plano: el primer valor de cada nombre. */
export function flattenSearchParams(params: URLSearchParams | { forEach(cb: (value: string, key: string) => void): void }): Record<string, string> {
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    if (!(key in out)) out[key] = value;
  });
  return out;
}
