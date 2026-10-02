/**
 * Ítems del menú lateral, como datos puros (F13). Es la fuente única del orden
 * y los nombres; el sidebar les pone el ícono. Testeable sin React.
 *
 * Bloque N (requerimientos v2.0, seccion 4): el menu pasa de lista plana a
 * grupos con titulo. Dashboards y Bandeja quedan sueltos arriba; Integraciones
 * y Ajustes, pegados al fondo. `navSections` hace el agrupamiento real.
 *
 * Broadcasts, Sequences y Growth NO estan aca: son sub-pestañas de Inbox
 * (components/comunicacion/section-tabs.tsx). Inbox es el hub de comunicacion,
 * y las tres son formas de mandar o provocar mensajes, no secciones aparte.
 * Channels tampoco: sale del menu (D3), pero la pantalla se conserva entera y
 * se llega desde el detalle de Zernio/Evolution en Integraciones.
 */
export type NavGroupId = "inicio" | "adquisicion" | "ventas" | "automatizacion" | "sistema";

export interface NavGroupMeta {
  id: NavGroupId;
  /**
   * null = sin titulo: son los dos items sueltos de arriba (`inicio`) y el
   * bloque del fondo (`sistema`), que se separa con una linea en vez de un
   * titulo (ver N3).
   */
  title: string | null;
}

/** El orden de los grupos, tal cual se renderizan. */
export const NAV_GROUPS: NavGroupMeta[] = [
  { id: "inicio", title: null },
  { id: "adquisicion", title: "Adquisición" },
  // Arranca con dos items: no existe el modulo de Ventas todavia (D2). El
  // lugar de Facturacion queda reservado para cuando ese modulo exista; no se
  // agrega un item que hoy no tendria a donde ir.
  { id: "ventas", title: "Ventas" },
  { id: "automatizacion", title: "Automatización" },
  { id: "sistema", title: null },
];

export interface NavItemMeta {
  name: string;
  href: string;
  icon: string;
  adminOnly: boolean;
  group: NavGroupId;
  /**
   * Visible si la persona tiene ALGUNO de estos permisos (Etapa 4). Owner y
   * Admin los tienen todos, asi que para ellos no cambia nada. Sin esta lista,
   * el item se muestra a cualquier miembro (o solo a admins, si adminOnly).
   */
  permissions?: string[];
}

export const NAV_ITEMS: NavItemMeta[] = [
  { name: "Dashboards", href: "/dashboard/dashboards/chat", icon: "LayoutGrid", adminOnly: false, group: "inicio" },
  { name: "Bandeja", href: "/dashboard/inbox", icon: "MessageSquare", adminOnly: false, group: "inicio" },

  { name: "Contenido", href: "/dashboard/content", icon: "Clapperboard", adminOnly: false, group: "adquisicion" },
  // Social: el perfil de cada red y sus publicaciones. Owner/Admin hasta el
  // bloque 9, donde pasa al permiso `social.view` y un rol personalizado
  // puede darselo a un Member.
  { name: "Social", href: "/dashboard/social", icon: "Grid3x3", adminOnly: true, group: "adquisicion" },

  { name: "Contactos", href: "/dashboard/contacts", icon: "Users", adminOnly: false, group: "ventas" },
  // Agenda (Etapa 4, F8): abre directo las agendas. La configuracion va
  // detras del engranaje de esa pantalla, no del menu.
  { name: "Agenda", href: "/dashboard/agenda", icon: "CalendarDays", adminOnly: false, permissions: ["scheduling.use", "bookings.view"], group: "ventas" },

  { name: "Automatizaciones", href: "/dashboard/flows", icon: "GitBranch", adminOnly: false, group: "automatizacion" },
  { name: "Agentes", href: "/dashboard/agents", icon: "Bot", adminOnly: false, group: "automatizacion" },
  { name: "Conocimiento", href: "/dashboard/knowledge", icon: "BookOpen", adminOnly: true, group: "automatizacion" },

  // Integraciones (nuevo, N1): se llega desde Ajustes hoy en dia (el href no
  // cambia, N4 ya la deja marcada por su propio item). adminOnly, como el
  // resto de las pantallas de admin (N2): la clave `integrations.manage`
  // existe, pero el item sigue el mismo criterio que sus vecinas del fondo
  // para no desalinearse de member-baseline.
  { name: "Integraciones", href: "/dashboard/settings/integrations", icon: "Blocks", adminOnly: true, group: "sistema" },
  { name: "Ajustes", href: "/dashboard/settings", icon: "Settings", adminOnly: true, group: "sistema" },
];

/**
 * Los items que ve una persona con estos permisos (F8).
 *
 * Es la regla del menu en un solo lugar, sin React: `adminOnly` sigue
 * valiendo por rol (es lo que fija member-baseline), y `permissions` se
 * evalua sobre las claves del rol resuelto.
 */
export function visibleNavItems<T extends Pick<NavItemMeta, "adminOnly" | "permissions">>(
  items: T[],
  viewer: { isAdmin: boolean; permissionKeys: string[] },
): T[] {
  return items.filter((item) => {
    if (item.adminOnly && !viewer.isAdmin) return false;
    if (item.permissions && !viewer.isAdmin) {
      return item.permissions.some((key) => viewer.permissionKeys.includes(key));
    }
    return true;
  });
}

export interface NavSection<T> {
  group: NavGroupId;
  title: string | null;
  items: T[];
}

/**
 * Agrupa items YA FILTRADOS (por `visibleNavItems`) segun `NAV_GROUPS`.
 *
 * Un grupo sin ningun item visible no se devuelve: un titulo sin nada debajo
 * es un bug visual (N1). El orden es siempre el de `NAV_GROUPS`, nunca el de
 * aparicion en `items`.
 */
export function navSections<T extends Pick<NavItemMeta, "group">>(items: T[]): NavSection<T>[] {
  return NAV_GROUPS.map((g) => ({
    group: g.id,
    title: g.title,
    items: items.filter((item) => item.group === g.id),
  })).filter((section) => section.items.length > 0);
}

/**
 * El tooltip de un item colapsado (N3): nombre y, si el grupo tiene titulo,
 * el grupo. Los sueltos (`inicio`, `sistema`) no agregan nada: ya se
 * distinguen por su posicion (arriba del todo o pegados al fondo).
 */
export function navItemTooltip(item: Pick<NavItemMeta, "name" | "group">): string {
  const group = NAV_GROUPS.find((g) => g.id === item.group);
  return group?.title ? `${item.name} · ${group.title}` : item.name;
}
