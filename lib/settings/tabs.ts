/**
 * Las pestañas de Ajustes, como datos puros (S1).
 *
 * Antes eran cuatro: General, Equipo y roles, Integraciones y Tareas.
 * `custom-fields` y `recursos` tenían ruta propia pero habían quedado
 * afuera del sistema de pestañas. Luego fueron seis y Contenido (pilares y
 * ofertas, F89) hizo siete; esa pestaña hoy es Productos (octubre 2026): se mantiene el mecanismo
 * de sub-rutas (no se migra a `?tab=`) y el patrón de "otras rutas que
 * dejan esta pestaña marcada" (`also`), que ya existía para Roles.
 */

export interface SettingsTab {
  name: string;
  href: string;
  /** Otras rutas que dejan esta pestaña marcada. */
  also?: string[];
}

export const SETTINGS_TABS: SettingsTab[] = [
  { name: "General", href: "/dashboard/settings" },
  {
    name: "Equipo y roles",
    href: "/dashboard/settings/team",
    also: ["/dashboard/settings/roles"],
  },
  { name: "Campos personalizados", href: "/dashboard/settings/custom-fields" },
  {
    // Las dos rutas de `also` solo redirigen (F17/F20 se unificaron en
    // /recursos): un marcador o un link viejo que llegue ahí tiene que
    // mostrar la pestaña marcada igual, aunque rebote enseguida.
    name: "Recursos",
    href: "/dashboard/settings/recursos",
    also: ["/dashboard/settings/templates", "/dashboard/settings/audios"],
  },
  {
    // Antes "Contenido" (pilares y ofertas): los pilares se mudaron a la pagina de
    // Contenido y las ofertas pasaron a ser productos. La ruta vieja solo redirige.
    name: "Productos",
    href: "/dashboard/settings/productos",
    also: ["/dashboard/settings/contenido"],
  },
  { name: "Integraciones", href: "/dashboard/settings/integrations" },
  { name: "Tareas", href: "/dashboard/settings/background" },
];

/**
 * El `href` de la pestaña activa para ese pathname, o "" si ninguna matchea.
 *
 * General es la raíz: se marca solo con igualdad exacta, porque si no
 * quedaría activa en cualquier sub-ruta de Ajustes.
 */
export function activeSettingsTab(pathname: string): string {
  for (const tab of SETTINGS_TABS) {
    const active =
      tab.href === "/dashboard/settings"
        ? pathname === tab.href
        : pathname.startsWith(tab.href) ||
          (tab.also ?? []).some((h) => pathname.startsWith(h));
    if (active) return tab.href;
  }
  return "";
}
