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
  /**
   * Otras rutas que TAMBIEN dejan este item marcado como activo (N4), ademas
   * de su propio `href`. Lo resuelve `lib/nav/active.ts`: gana, entre todos
   * los items, el candidato (href o alsoActiveOn) mas largo que matchee.
   */
  alsoActiveOn?: string[];
}

export const NAV_ITEMS: NavItemMeta[] = [
  // alsoActiveOn: "/dashboard/dashboards" (sin el /chat) para que las otras
  // pantallas de dashboards (ads, content, unified y sus detalles) tambien
  // dejen marcado este item. Antes del bloque N ninguna lo hacia (N4).
  { name: "Dashboards", href: "/dashboard/dashboards/chat", icon: "LayoutGrid", adminOnly: false, group: "inicio", alsoActiveOn: ["/dashboard/dashboards"] },
  // La cola de borradores y las sub-pestañas de la bandeja (broadcasts,
  // sequences, growth) son la misma seccion: dejan Bandeja marcada (N4).
  { name: "Bandeja", href: "/dashboard/inbox", icon: "MessageSquare", adminOnly: false, group: "inicio", alsoActiveOn: ["/dashboard/drafts", "/dashboard/broadcasts", "/dashboard/sequences", "/dashboard/growth"] },

  { name: "Contenido", href: "/dashboard/content", icon: "Clapperboard", adminOnly: false, group: "adquisicion" },
  // Social: el perfil de cada red y sus publicaciones. Se ve con el permiso
  // `social.view` (F78): Owner y Admin lo tienen siempre, y un rol
  // personalizado se lo puede dar a un Member.
  { name: "Social", href: "/dashboard/social", icon: "Grid3x3", adminOnly: false, permissions: ["social.view"], group: "adquisicion" },

  { name: "Contactos", href: "/dashboard/contacts", icon: "Users", adminOnly: false, group: "ventas" },
  // Agenda (Etapa 4, F8): abre directo las agendas. La configuracion va
  // detras del engranaje de esa pantalla, no del menu.
  { name: "Agenda", href: "/dashboard/agenda", icon: "CalendarDays", adminOnly: false, permissions: ["scheduling.use", "bookings.view"], group: "ventas" },

  { name: "Automatizaciones", href: "/dashboard/flows", icon: "GitBranch", adminOnly: false, group: "automatizacion" },
  { name: "Agentes IA", href: "/dashboard/agents", icon: "Bot", adminOnly: false, group: "automatizacion" },
  { name: "Conocimiento", href: "/dashboard/knowledge", icon: "BookOpen", adminOnly: true, group: "automatizacion" },
  // Recursos (banca v2, F3): la MISMA pantalla que la pestaña "Recursos" de
  // Ajustes, con un segundo camino para llegar. Es el patron de Integraciones
  // (una pantalla, dos caminos), pero visible para todos: un Member la usa
  // todos los dias desde la bandeja y tiene que poder leer y escuchar cada
  // recurso. Crear y editar lo decide `templates.manage`, no el menu. Gana
  // sobre Ajustes en su ruta por ser el candidato mas largo (N4).
  // alsoActiveOn: las dos rutas viejas, igual que la pestaña (lib/settings/tabs.ts).
  { name: "Recursos", href: "/dashboard/settings/recursos", icon: "Library", adminOnly: false, group: "automatizacion", alsoActiveOn: ["/dashboard/settings/templates", "/dashboard/settings/audios"] },

  // Integraciones (nuevo, N1): es sub-ruta de Ajustes (gana por ser el
  // candidato mas largo, N4), y ademas deja marcado a Channels: esa pantalla
  // ya no tiene item propio (D3), pero conceptualmente cuelga de Integraciones
  // (se llega desde el detalle de Zernio/Evolution). adminOnly, como el resto
  // de las pantallas de admin (N2): la clave `integrations.manage` existe,
  // pero el item sigue el mismo criterio que sus vecinas del fondo para no
  // desalinearse de member-baseline.
  { name: "Integraciones", href: "/dashboard/settings/integrations", icon: "Blocks", adminOnly: true, group: "sistema", alsoActiveOn: ["/dashboard/channels"] },
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
  /**
   * Colapsado (N3), el titulo del grupo se esconde y en su lugar va una
   * linea fina. `true` para toda seccion salvo la primera que queda visible:
   * nunca hay una linea antes de la primera (arriba del todo no hace falta
   * separar de nada), ni una de mas si un grupo quedo vacio y no se
   * renderizo.
   */
  separatorBefore: boolean;
}

/**
 * Agrupa items YA FILTRADOS (por `visibleNavItems`) segun `NAV_GROUPS`.
 *
 * Un grupo sin ningun item visible no se devuelve: un titulo sin nada debajo
 * es un bug visual (N1). El orden es siempre el de `NAV_GROUPS`, nunca el de
 * aparicion en `items`.
 */
export function navSections<T extends Pick<NavItemMeta, "group">>(items: T[]): NavSection<T>[] {
  const visibles = NAV_GROUPS.map((g) => ({
    group: g.id,
    title: g.title,
    items: items.filter((item) => item.group === g.id),
  })).filter((section) => section.items.length > 0);

  return visibles.map((section, idx) => ({ ...section, separatorBefore: idx > 0 }));
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
