/**
 * Que item del menu queda marcado segun la ruta (bloque N, N4).
 *
 * Antes: cada item se marcaba por su cuenta (`pathname.startsWith(href)`,
 * como texto, no por segmento), con una excepcion escrita a mano para Inbox.
 * Eso no alcanzaba para Integraciones, que es sub-ruta de Ajustes
 * (`/dashboard/settings/*`): ahi tiene que ganar siempre el mas especifico, y
 * una excepcion a mano para ESE caso particular hubiera sido la tercera.
 *
 * Ahora: cada item declara su `href` y, opcionalmente, otras rutas que
 * TAMBIEN lo dejan activo (`alsoActiveOn`, en items.ts: la excepcion de
 * Inbox/Bandeja y la de Integraciones/Channels son datos, no codigo). Entre
 * todos los items visibles, gana el candidato (href o algun alsoActiveOn) mas
 * largo que matchee por PREFIJO DE SEGMENTO: "/dashboard/settings" ya no
 * matchea "/dashboard/settingsx" (el bug de texto que tenia la version vieja).
 */

interface ActiveCandidate {
  href: string;
  alsoActiveOn?: string[];
}

/** ¿`pathname` cae dentro de `prefix`? Por segmento, no por texto crudo. */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

/** El candidato de `item` (href o algun alsoActiveOn) mas largo que matchea, o null. */
function bestMatch(pathname: string, item: ActiveCandidate): string | null {
  const candidatos = [item.href, ...(item.alsoActiveOn ?? [])];
  const matches = candidatos.filter((c) => matchesPrefix(pathname, c));
  if (matches.length === 0) return null;
  return matches.reduce((largo, actual) => (actual.length > largo.length ? actual : largo));
}

/**
 * ¿Esta ruta deja a ESTE item en particular activo?
 *
 * No resuelve empates entre items: dos items pueden devolver `true` para la
 * misma ruta (es justamente el caso de Integraciones y Ajustes). Para elegir
 * CUAL queda marcado entre varios, usar `activeNavHref`.
 */
export function isNavItemActive(pathname: string, item: ActiveCandidate): boolean {
  return bestMatch(pathname, item) !== null;
}

/**
 * El href del item activo entre varios: el que tiene el candidato mas largo.
 * Si dos matchean (Integraciones es sub-ruta de Ajustes), gana el mas
 * especifico. En un empate exacto de longitud, gana el que aparece primero
 * en `items` (no deberia pasar con las rutas reales del sistema).
 */
export function activeNavHref<T extends ActiveCandidate>(pathname: string, items: T[]): string | null {
  let mejor: { href: string; largo: number } | null = null;
  for (const item of items) {
    const match = bestMatch(pathname, item);
    if (match === null) continue;
    if (!mejor || match.length > mejor.largo) {
      mejor = { href: item.href, largo: match.length };
    }
  }
  return mejor?.href ?? null;
}
