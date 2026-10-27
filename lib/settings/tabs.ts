/**
 * Las pestañas de Ajustes, como datos puros (S1).
 *
 * Cada pestaña puede tener sub-rutas (no `?tab=`) y "otras rutas que la
 * dejan marcada" (`also`), como Roles dentro de Equipo.
 */

export interface SettingsTab {
  name: string;
  href: string;
  /** Otras rutas que dejan esta pestaña marcada. */
  also?: string[];
  /**
   * Se ve con ALGUNA de estas claves. Sin lista, la ve cualquier miembro (Recursos: la usa
   * todo el equipo todos los dias). Owner y Admin tienen todas las claves.
   */
  permissions?: string[];
}

export const SETTINGS_TABS: SettingsTab[] = [
  { name: "General", href: "/dashboard/settings", permissions: ["settings.general", "sales.settings", "expenses.manage"] }, // @plantilla-quitar(ventas,finanzas)
  // @plantilla-sin(ventas,finanzas): { name: "General", href: "/dashboard/settings", permissions: ["settings.general"] },
  {
    name: "Equipo y roles",
    href: "/dashboard/settings/team",
    also: ["/dashboard/settings/roles"],
    permissions: ["team.view", "team.invite", "team.manage", "roles.view", "roles.manage"],
  },
  { name: "Campos personalizados", href: "/dashboard/settings/custom-fields", permissions: ["custom_fields.manage"] },
  // Pipeline de contactos (00245): las listas de estados de setter y de vendedor.
  { name: "Estados", href: "/dashboard/settings/estados", permissions: ["contact_statuses.manage"] },
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
    permissions: ["products.manage"],
  },
  // Reglas de asignacion (F13): como se asignan solos setter, vendedor y referido.
  { name: "Asignación", href: "/dashboard/settings/asignacion", permissions: ["assignment.manage"] },
  { name: "Integraciones", href: "/dashboard/settings/integrations", permissions: ["integrations.view", "integrations.manage", "channels.manage"] },
  // "Tareas" se mudo a Agentes IA (Bloque Agentes IA): /dashboard/settings/background  @plantilla-quitar(proyecto)
  // ahora solo redirige, ya no es una pestana de Ajustes.  @plantilla-quitar(proyecto)
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

/**
 * Las pestañas que ve quien pregunta (S1): las que no piden permiso, y las que piden alguno
 * que tiene. Función pura: la pantalla solo la compone.
 *
 * Recursos e Integraciones salieron del menú lateral (plano formularios-ui, D4) y se llega a ellas desde
 * Ajustes. Recursos no pide permiso: la ve cualquier miembro (la usa todos los días desde la bandeja), así
 * que a un Member de sistema solo le queda esa; Owner y Admin ven todas.
 */
export function visibleSettingsTabs(can: (key: string) => boolean): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => !tab.permissions || tab.permissions.some((key) => can(key)));
}

/**
 * A dónde lleva "Ajustes" en el menú: a la primera pestaña que esta persona ve. Un Member no abre General
 * (pide una clave de Ajustes): entra por Recursos.
 */
export function settingsEntryHref(can: (key: string) => boolean): string {
  return visibleSettingsTabs(can)[0]?.href ?? SETTINGS_TABS[0].href;
}

/**
 * Las claves que dan una pestaña de Ajustes con permiso, más la Actividad (que cuelga de General). La usa
 * `catalog-usage.test.ts` para saber que esas claves tienen un uso; el menú ya no las lee (Ajustes se ve con
 * `requires: "settings"`, que calcula el layout con `visibleSettingsTabs`).
 */
export const SETTINGS_NAV_PERMISSIONS: string[] = [
  ...new Set([...SETTINGS_TABS.flatMap((tab) => tab.permissions ?? []), "audit.view"]),
];
