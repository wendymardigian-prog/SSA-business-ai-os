/**
 * Si la seccion "Herramientas" del menu se ve abierta (plano formularios-ui, F2).
 *
 * Reglas:
 *  - Arranca cerrada (sin nada guardado).
 *  - Si la pantalla activa esta adentro, se ve abierta aunque la persona la haya cerrado.
 *  - Lo ultimo que eligio la persona se recuerda en el navegador (`localStorage`, `"1"` o `"0"`).
 *
 * Pura: el mecanismo (la clase del <html>, la clave y el script del <head>) vive en
 * `components/sidebar.tsx` y `app/layout.tsx`, igual que el colapso del menu.
 */

import { NAV_ITEMS } from "./items";

/** La clase del <html> y la clave de localStorage: un solo nombre para las dos. */
export const TOOLS_OPEN_KEY = "nav-tools-open";

export type StoredToolsOpen = "1" | "0" | null | undefined;

/** Las rutas de los items de Herramientas, con las que tambien los dejan marcados. */
function toolsRoutes(): string[] {
  return NAV_ITEMS.filter((item) => item.group === "herramientas").flatMap((item) => [item.href, ...(item.alsoActiveOn ?? [])]);
}

/** El item marcado como activo (su `href`) esta dentro de Herramientas. */
export function activeInsideTools(activeHref: string | null | undefined): boolean {
  if (!activeHref) return false;
  return NAV_ITEMS.some((item) => item.group === "herramientas" && item.href === activeHref) || toolsRoutes().includes(activeHref);
}

export function toolsOpen(stored: StoredToolsOpen, activeHref: string | null | undefined): boolean {
  if (activeInsideTools(activeHref)) return true;
  return stored === "1";
}
