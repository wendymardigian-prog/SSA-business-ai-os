/**
 * A donde lleva cada pestaña de comunicacion (Bloque I, I5).
 *
 * Los filtros de la Bandeja viven en la URL. Si la pestaña "Conversaciones"
 * apuntara siempre a `/dashboard/inbox` pelado, ir a Broadcasts y volver los
 * borraria. Por eso esa pestaña vuelve con la query que tenia la Bandeja la
 * ultima vez que se la miro (la recuerda el componente, en sessionStorage).
 *
 * Las otras tres no arrastran nada: la busqueda de la Bandeja (`?q=`) no tiene
 * por que filtrar los broadcasts.
 *
 * Modulo puro: lo usa `components/comunicacion/section-tabs.tsx`.
 */

export const INBOX_HREF = "/dashboard/inbox";

/** La clave de sessionStorage donde se recuerda la query de la Bandeja. */
export const INBOX_QUERY_STORAGE_KEY = "comunicacion:inbox-query";

/** La pestaña marcada: prefijo, para que el detalle de una secuencia deje marcada la suya. */
export function isTabActive(tabHref: string, pathname: string): boolean {
  return pathname.startsWith(tabHref);
}

/**
 * El href de una pestaña.
 *
 * - En la Bandeja misma, "Conversaciones" conserva la query actual.
 * - Desde otra seccion, vuelve con la query recordada (si la hay).
 * - El resto de las pestañas, su ruta tal cual.
 */
export function comunicacionTabHref(
  tabHref: string,
  pathname: string,
  currentQuery: string,
  rememberedInboxQuery: string | null,
): string {
  if (tabHref !== INBOX_HREF) return tabHref;
  const query = isTabActive(INBOX_HREF, pathname) ? currentQuery : (rememberedInboxQuery ?? "");
  const clean = query.replace(/^\?/, "");
  return clean ? `${INBOX_HREF}?${clean}` : INBOX_HREF;
}
