/**
 * Ítems del menú lateral, como datos puros (F13). Es la fuente única del orden
 * y los nombres; el sidebar les pone el ícono. Testeable sin React.
 *
 * Broadcasts, Sequences y Growth NO estan aca: son sub-pestañas de Inbox
 * (components/comunicacion/section-tabs.tsx). Inbox es el hub de comunicacion,
 * y las tres son formas de mandar o provocar mensajes, no secciones aparte.
 * Integraciones tampoco: se llega desde Settings, que ya la enlaza. Las cuatro
 * rutas siguen existiendo igual; lo unico que cambio es por donde se llega.
 */
export interface NavItemMeta {
  name: string;
  href: string;
  icon: string;
  adminOnly: boolean;
  /**
   * Visible si la persona tiene ALGUNO de estos permisos (Etapa 4). Owner y
   * Admin los tienen todos, asi que para ellos no cambia nada. Sin esta lista,
   * el item se muestra a cualquier miembro (o solo a admins, si adminOnly).
   */
  permissions?: string[];
}

export const NAV_ITEMS: NavItemMeta[] = [
  { name: "Dashboards", href: "/dashboard/dashboards/chat", icon: "LayoutGrid", adminOnly: false },
  { name: "Flows", href: "/dashboard/flows", icon: "GitBranch", adminOnly: false },
  { name: "Contenido", href: "/dashboard/content", icon: "Clapperboard", adminOnly: false },
  // Social: el perfil de cada red y sus publicaciones. Owner/Admin hasta el
  // bloque 9, donde pasa al permiso `social.view` y un rol personalizado
  // puede darselo a un Member.
  { name: "Social", href: "/dashboard/social", icon: "Grid3x3", adminOnly: true },
  { name: "Inbox", href: "/dashboard/inbox", icon: "MessageSquare", adminOnly: false },
  { name: "Contacts", href: "/dashboard/contacts", icon: "Users", adminOnly: false },
  // Agenda (Etapa 4, F8): abre directo las agendas. La configuracion va
  // detras del engranaje de esa pantalla, no del menu.
  { name: "Agenda", href: "/dashboard/agenda", icon: "CalendarDays", adminOnly: false, permissions: ["scheduling.use", "bookings.view"] },
  { name: "Channels", href: "/dashboard/channels", icon: "Plug", adminOnly: true },
  { name: "Agentes", href: "/dashboard/agents", icon: "Bot", adminOnly: false },
  { name: "Conocimiento", href: "/dashboard/knowledge", icon: "BookOpen", adminOnly: true },
  { name: "Settings", href: "/dashboard/settings", icon: "Settings", adminOnly: true },
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
