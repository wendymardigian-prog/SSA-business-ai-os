/**
 * Que item del menu queda marcado segun la ruta (F13).
 *
 * Hasta ahora la regla vivia inline en el render de components/sidebar.tsx.
 * Se separa aca, SIN cambiar nada, para poder testearla sin montar React ni
 * un DOM. El bloque N (N4, requerimientos v2.0 seccion 4) la generaliza
 * ("gana el prefijo mas largo" + un campo `alsoActiveOn` por item) en un
 * commit aparte, justamente para poder comparar el antes y el despues.
 */

/** La cola de borradores y las sub-pestañas de Inbox dejan Inbox marcado. */
const INBOX_HREF = "/dashboard/inbox";
const INBOX_ALSO_ACTIVE = [
  "/dashboard/drafts",
  "/dashboard/broadcasts",
  "/dashboard/sequences",
  "/dashboard/growth",
];

/** La regla de hoy para UN item: prefijo exacto, mas la excepcion de Inbox. */
export function isNavItemActive(pathname: string, href: string): boolean {
  return (
    pathname.startsWith(href) ||
    (href === INBOX_HREF && INBOX_ALSO_ACTIVE.some((also) => pathname.startsWith(also)))
  );
}

/**
 * El href del item activo entre varios, o null si ninguno matchea.
 *
 * Hoy, con los items de NAV_ITEMS, nunca hay mas de un match: ningun href es
 * prefijo de otro. Por eso el primero que matchea es, de hecho, el unico.
 * Ese supuesto deja de valer en N4 (Integraciones es sub-ruta de Ajustes) y
 * ahi es donde la regla cambia a "gana el prefijo mas largo".
 */
export function activeNavHref(pathname: string, items: { href: string }[]): string | null {
  const active = items.find((item) => isNavItemActive(pathname, item.href));
  return active?.href ?? null;
}
