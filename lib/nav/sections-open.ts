/**
 * Si una seccion del menu se ve abierta (plano formularios-ui F2; todas las secciones con titulo desde el
 * 9/11/2026, antes solo Herramientas).
 *
 * Reglas:
 *  - Sin nada guardado, como se veia antes de que todas se colapsaran: Herramientas cerrada y las demas
 *    abiertas (`SECTION_DEFAULT_OPEN`). Asi nadie del equipo encuentra el menu cambiado de golpe.
 *  - Si la pantalla activa esta adentro, se ve abierta aunque la persona la haya cerrado.
 *  - Lo ultimo que eligio la persona se recuerda en el navegador (`localStorage`, `"1"` o `"0"`), una
 *    clave por seccion. Es comodidad del navegador; la favorita de cada seccion si va a la base.
 *
 * Pura: el mecanismo (la clase del <html>, la clave y el script del <head>) vive en
 * `components/sidebar.tsx` y `app/layout.tsx`, igual que el colapso del menu.
 */

import { COLLAPSIBLE_GROUPS, NAV_ITEMS, type NavGroupId } from "./items";

/** Prefijo de la clase del <html> y de la clave de localStorage: `nav-open-<grupo>`. */
export const SECTION_OPEN_PREFIX = "nav-open-";

/** La clave vieja de Herramientas (antes de que todas las secciones se colapsaran): se sigue leyendo. */
export const LEGACY_TOOLS_OPEN_KEY = "nav-tools-open";

export type StoredOpen = "1" | "0" | null | undefined;

export function sectionOpenKey(group: NavGroupId): string {
  return `${SECTION_OPEN_PREFIX}${group}`;
}

/**
 * Las clases que esconden los items de una seccion cerrada. Escritas ENTERAS a proposito: Tailwind solo
 * genera las clases que encuentra literales en el codigo (un template string no sirve). Cada `open-<grupo>`
 * es una variante de `app/globals.css`. Con el menu angosto (`collapsed:`) se ven todos los iconos.
 */
export const SECTION_HIDDEN_CLASS: Partial<Record<NavGroupId, string>> = {
  adquisicion: "hidden open-adquisicion:block collapsed:block",
  ventas: "hidden open-ventas:block collapsed:block",
  servicio: "hidden open-servicio:block collapsed:block", // @plantilla-quitar(ventas)
  herramientas: "hidden open-herramientas:block collapsed:block",
};

/** Las secciones que arrancan abiertas sin nada guardado (las que antes no se podian cerrar). */
export const SECTION_DEFAULT_OPEN: Partial<Record<NavGroupId, boolean>> = {
  adquisicion: true,
  ventas: true,
  servicio: true, // @plantilla-quitar(ventas)
};

/** El grupo colapsable donde esta el item activo (su `href`), o null. */
export function activeSectionGroup(activeHref: string | null | undefined): NavGroupId | null {
  if (!activeHref) return null;
  const item = NAV_ITEMS.find(
    (i) => COLLAPSIBLE_GROUPS.includes(i.group) && (i.href === activeHref || (i.alsoActiveOn ?? []).includes(activeHref)),
  );
  return item?.group ?? null;
}

export function sectionOpen(group: NavGroupId, stored: StoredOpen, activeHref: string | null | undefined): boolean {
  if (activeSectionGroup(activeHref) === group) return true;
  if (stored === null || stored === undefined) return SECTION_DEFAULT_OPEN[group] === true;
  return stored === "1";
}

/**
 * El script del <head> (app/layout.tsx): pone `nav-open-<grupo>` en el <html> antes de pintar, para cada
 * seccion abierta (guardada abierta, o sin nada guardado y abierta por defecto). Herramientas respeta
 * tambien la clave vieja si la nueva no se guardo nunca. Sin almacenamiento (ventana privada), quedan los
 * valores por defecto.
 */
export function sectionsOpenHeadScript(): string {
  const groups = JSON.stringify(COLLAPSIBLE_GROUPS);
  const defaults = JSON.stringify(COLLAPSIBLE_GROUPS.filter((g) => SECTION_DEFAULT_OPEN[g] === true));
  return `(function(){var c=document.documentElement.classList,d=${defaults};${groups}.forEach(function(g){var v=null;try{v=localStorage.getItem("${SECTION_OPEN_PREFIX}"+g);if(v===null&&g==="herramientas")v=localStorage.getItem("${LEGACY_TOOLS_OPEN_KEY}")}catch(e){}if(v==="1"||(v===null&&d.indexOf(g)>=0))c.add("${SECTION_OPEN_PREFIX}"+g)})})();`;
}
