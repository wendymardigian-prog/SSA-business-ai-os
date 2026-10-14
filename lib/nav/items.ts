/**
 * Ítems del menú lateral, como datos puros (F13). Es la fuente única del orden
 * y los nombres; el sidebar les pone el ícono. Testeable sin React.
 *
 * Bloque N (requerimientos v2.0, seccion 4): el menu pasa de lista plana a
 * grupos con titulo. Dashboards y Bandeja quedan sueltos arriba.
 * `navSections` hace el agrupamiento real.
 *
 * Plano formularios-ui (D1-D4): las herramientas de uso menos diario van a la
 * seccion "Herramientas", que se colapsa (Automatizaciones, Formularios,
 * Agentes IA y Ajustes). Conocimiento, Recursos e Integraciones salen del menu:
 * Conocimiento se abre desde Agentes IA (boton de la barra) y Recursos e
 * Integraciones son pestañas de Ajustes. Sus rutas siguen andando.
 *
 * Broadcasts, Sequences y Growth NO estan aca: son sub-pestañas de Inbox
 * (components/comunicacion/section-tabs.tsx). Inbox es el hub de comunicacion,
 * y las tres son formas de mandar o provocar mensajes, no secciones aparte.
 * Channels tampoco: sale del menu (D3), pero la pantalla se conserva entera y
 * se llega desde el detalle de Zernio/Evolution en Integraciones.
 */

import { settingsEntryHref } from "@/lib/settings/tabs";
export type NavGroupId = "inicio" | "adquisicion" | "ventas" | "herramientas";

export interface NavGroupMeta {
  id: NavGroupId;
  /** null = sin titulo: son los items sueltos de arriba (`inicio`). */
  title: string | null;
  /** El titulo es un boton que abre y cierra el grupo (solo Herramientas). */
  collapsible?: boolean;
}

/** El orden de los grupos, tal cual se renderizan. */
export const NAV_GROUPS: NavGroupMeta[] = [
  { id: "inicio", title: null },
  { id: "adquisicion", title: "Adquisición" },
  // Contactos, Agenda, Llamadas y Ventas (Etapa 5).
  { id: "ventas", title: "Ventas" },
  { id: "herramientas", title: "Herramientas", collapsible: true },
];

/** Condiciones del menú que se calculan en el servidor (no son un permiso). */
export type NavFlag = "eod" | "settings";

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
  /**
   * Visible solo si la condición calculada en el servidor es verdadera, también para
   * Owner y Admin: "Mi reporte del día" aparece si la persona está en la audiencia de
   * algún reporte de fin de día publicado (`lib/eod/nav-flag.ts`).
   */
  requires?: NavFlag;
}

export const NAV_ITEMS: NavItemMeta[] = [
  // alsoActiveOn: "/dashboard/dashboards" (sin el /chat) para que las otras
  // pantallas de dashboards (ads, content, unified y sus detalles) tambien
  // dejen marcado este item. Antes del bloque N ninguna lo hacia (N4).
  { name: "Dashboards", href: "/dashboard/dashboards/chat", icon: "LayoutGrid", adminOnly: false, group: "inicio", alsoActiveOn: ["/dashboard/dashboards"] },
  // La cola de borradores y las sub-pestañas de la bandeja (broadcasts,
  // sequences, growth) son la misma seccion: dejan Bandeja marcada (N4).
  { name: "Bandeja", href: "/dashboard/inbox", icon: "MessageSquare", adminOnly: false, group: "inicio", alsoActiveOn: ["/dashboard/drafts", "/dashboard/broadcasts", "/dashboard/sequences", "/dashboard/growth"] },
  // Tareas (Extra A): el trabajo pendiente del equipo, junto a la bandeja. Se ve con `tasks.view`:
  // el Member de sistema lo tiene (ve las que creo, tiene a cargo o sigue).
  { name: "Tareas", href: "/dashboard/tareas", icon: "ListTodo", adminOnly: false, permissions: ["tasks.view"], group: "inicio" },
  // Reporte de fin de día (E10): completarlo no necesita permiso, alcanza con estar en
  // la audiencia de un EOD publicado. Por eso es una condición del servidor y no un permiso.
  { name: "Mi reporte del día", href: "/dashboard/eod", icon: "ListChecks", adminOnly: false, group: "inicio", requires: "eod" },

  { name: "Contenido", href: "/dashboard/content", icon: "Clapperboard", adminOnly: false, group: "adquisicion" },
  // Social: el perfil de cada red y sus publicaciones. Se ve con el permiso
  // `social.view` (F78): Owner y Admin lo tienen siempre, y un rol
  // personalizado se lo puede dar a un Member.
  { name: "Social", href: "/dashboard/social", icon: "Grid3x3", adminOnly: false, permissions: ["social.view"], group: "adquisicion" },

  { name: "Contactos", href: "/dashboard/contacts", icon: "Users", adminOnly: false, group: "ventas" },
  // Agenda (Etapa 4, F8): abre directo las agendas. La configuracion va
  // detras del engranaje de esa pantalla, no del menu.
  { name: "Agenda", href: "/dashboard/agenda", icon: "CalendarDays", adminOnly: false, permissions: ["scheduling.use", "bookings.view"], group: "ventas" },
  // Llamadas (Fathom + analizador): menu propio (decision 151), debajo de
  // Agenda. Se ve con `calls.view`; un Member de sistema lo tiene (decision 152).
  { name: "Llamadas", href: "/dashboard/llamadas", icon: "PhoneCall", adminOnly: false, permissions: ["calls.view"], group: "ventas" },
  // Ventas y pagos (Etapa 5, F8): abre la lista de ventas, SIN engranaje. Los
  // productos y las reglas de asignacion viven en Ajustes. Va despues de
  // Llamadas: ese lugar ya estaba fijado por su test.
  { name: "Ventas", href: "/dashboard/ventas", icon: "CircleDollarSign", adminOnly: false, permissions: ["sales.view"], group: "ventas", alsoActiveOn: ["/dashboard/ventas"] },

  // Herramientas (plano formularios-ui, D1): la unica seccion colapsable. Orden fijo:
  // Automatizaciones, Formularios, Agentes IA y Ajustes.
  { name: "Automatizaciones", href: "/dashboard/flows", icon: "GitBranch", adminOnly: false, group: "herramientas" },
  // Formularios (personalizado, encuesta, contrato y fin de dia): se ve con `forms.view`.
  // El Member de sistema lo tiene (ve las respuestas de los contactos que ve);
  // crear y publicar lo decide `forms.manage`, no el menu.
  { name: "Formularios", href: "/dashboard/formularios", icon: "ClipboardList", adminOnly: false, permissions: ["forms.view"], group: "herramientas" },
  // Agentes IA: Conocimiento ya no es un item (D3): se abre con el boton "Conocimiento" de la
  // barra de esta pantalla (lib/nav/page-actions.ts), y mientras esta abierto queda marcado Agentes IA.
  { name: "Agentes IA", href: "/dashboard/agents", icon: "Bot", adminOnly: false, group: "herramientas", alsoActiveOn: ["/dashboard/knowledge"] },
  // Ajustes (D4): Recursos e Integraciones son pestañas de Ajustes y ya no son items. Se ve para quien
  // tenga al menos una pestaña (`requires: "settings"`, lo calcula el layout con `visibleSettingsTabs`):
  // un Member entra directo a Recursos. En cualquier pestaña, y en /dashboard/channels (que cuelga de
  // Integraciones y no tiene item propio), queda marcado Ajustes.
  { name: "Ajustes", href: "/dashboard/settings", icon: "Settings", adminOnly: false, requires: "settings", group: "herramientas", alsoActiveOn: ["/dashboard/channels"] },
];

/**
 * Los items que ve una persona con estos permisos (F8).
 *
 * Es la regla del menu en un solo lugar, sin React: `adminOnly` sigue
 * valiendo por rol (es lo que fija member-baseline), y `permissions` se
 * evalua sobre las claves del rol resuelto.
 */
export function visibleNavItems<T extends Pick<NavItemMeta, "adminOnly" | "permissions" | "requires">>(
  items: T[],
  viewer: { isAdmin: boolean; permissionKeys: string[]; flags?: Partial<Record<NavFlag, boolean>> },
): T[] {
  return items.filter((item) => {
    if (item.requires && viewer.flags?.[item.requires] !== true) return false;
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
  /** El titulo es un boton que abre y cierra el grupo (Herramientas, plano formularios-ui F2). */
  collapsible: boolean;
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
    collapsible: g.collapsible === true,
    items: items.filter((item) => item.group === g.id),
  })).filter((section) => section.items.length > 0);

  return visibles.map((section, idx) => ({ ...section, separatorBefore: idx > 0 }));
}

/**
 * El tooltip de un item colapsado (N3): nombre y, si el grupo tiene titulo,
 * el grupo. Los sueltos (`inicio`) no agregan nada: ya se
 * distinguen por su posicion (arriba del todo).
 */
export function navItemTooltip(item: Pick<NavItemMeta, "name" | "group">): string {
  const group = NAV_GROUPS.find((g) => g.id === item.group);
  return group?.title ? `${item.name} · ${group.title}` : item.name;
}

/**
 * A donde lleva un item para esta persona. Casi siempre es su `href`; "Ajustes" lleva a la primera
 * pestaña que la persona ve (un Member no puede abrir General: entra por Recursos).
 */
export function navItemHref(item: Pick<NavItemMeta, "href" | "requires">, viewer: { isAdmin: boolean }): string {
  return item.requires === "settings" ? settingsEntryHref(viewer) : item.href;
}
