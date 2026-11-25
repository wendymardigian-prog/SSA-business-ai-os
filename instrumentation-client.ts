import { NAV_START_EVENT, shouldTrackPush } from "@/lib/ui/nav-progress";

/**
 * Corre en el navegador antes de que arranque la app (convención de Next 16). Solo avisa cuándo empieza una
 * navegación, para la barra de carga del panel (`components/ui/nav-progress.tsx`): Next no da otra forma de saberlo
 * para un `router.push` (un filtro, el período de un dashboard, Tabla/Tablero). Es liviano a propósito: corre en todas
 * las páginas, también las públicas, donde nadie escucha el aviso.
 *
 * Nunca lanza: un error acá no puede frenar una navegación.
 */
export function onRouterTransitionStart(url: string, navigationType: "push" | "replace" | "traverse"): void {
  try {
    if (!shouldTrackPush(url, window.location.href)) return;
    window.dispatchEvent(new CustomEvent(NAV_START_EVENT, { detail: { url, navigationType } }));
  } catch {
    // Sin barra en esta navegación; la navegación sigue igual.
  }
}
