/**
 * Las reglas de la barra de carga del panel (`components/ui/nav-progress.tsx`): cuándo arranca, cuánto espera antes de
 * verse y cómo avanza. Puro, para poder probarlo sin navegador.
 *
 * La barra existe porque una navegación que solo cambia la búsqueda de la URL (una pestaña `?vista=`, un filtro, el
 * período de un dashboard) no tiene esqueleto: la pantalla quedaba congelada hasta que respondía el servidor (en RER-BAIOS
 * se midió 1,9 s sin ningún cambio, auditoría del 24/11/2026; traído a SSA el 25/11/2026).
 */

/**
 * El aviso de «empezó una navegación». Lo emite `instrumentation-client.ts` desde `onRouterTransitionStart`, el gancho
 * oficial de Next 16 que corre con cada `<Link>`, `router.push`, `router.replace` y atrás/adelante (no con
 * `router.refresh`, que lo usan refrescos en segundo plano). Lo escucha la barra del panel.
 */
export const NAV_START_EVENT = "ssa:nav-start";

/** Lo que tarda en verse: una navegación que ya es instantánea (esqueleto precargado, memoria de 30 s) no la muestra. */
export const SHOW_DELAY_MS = 150;
/** Lo que tarda en atenuarse el contenido viejo (`main[data-nav-pending]`, app/globals.css). */
export const DIM_DELAY_MS = 350;
/** Si la navegación nunca termina (falló o se canceló), la barra se va igual. */
export const SAFETY_TIMEOUT_MS = 15000;
/** Hasta dónde avanza sola: el último tramo lo completa la llegada de la pantalla. */
export const TRICKLE_CEILING = 0.9;

/** La ruta y la búsqueda ordenada, sin el `#`: dos direcciones que muestran lo mismo valen igual. */
export function normalizeUrl(url: URL): string {
  const params = [...url.searchParams.entries()].sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const search = new URLSearchParams(params).toString();
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return search ? `${path}?${search}` : path;
}

function parse(href: string, currentUrl: string): URL | null {
  try {
    return new URL(href, currentUrl);
  } catch {
    return null;
  }
}

/**
 * Un `router.push` / `router.replace` arranca la barra si va a otra pantalla o a otra búsqueda del mismo sitio.
 * Solo cambiar el `#`, quedarse en la misma dirección o ir a otro dominio no la arrancan.
 */
export function shouldTrackPush(href: string, currentUrl: string): boolean {
  if (typeof href !== "string" || href === "") return false;
  const target = parse(href, currentUrl);
  const current = parse(currentUrl, currentUrl);
  if (!target || !current) return false;
  if (target.protocol !== "http:" && target.protocol !== "https:") return false;
  if (target.origin !== current.origin) return false;
  return normalizeUrl(target) !== normalizeUrl(current);
}

/** Un paso del avance solo: cada vez más lento, nunca pasa de `TRICKLE_CEILING`. */
export function trickle(progress: number): number {
  const p = Math.min(Math.max(progress, 0), TRICKLE_CEILING);
  const next = p + (TRICKLE_CEILING - p) * 0.12;
  return Math.min(next, TRICKLE_CEILING);
}
