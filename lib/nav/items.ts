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
}

export const NAV_ITEMS: NavItemMeta[] = [
  { name: "Dashboards", href: "/dashboard/dashboards/chat", icon: "LayoutGrid", adminOnly: false },
  { name: "Flows", href: "/dashboard/flows", icon: "GitBranch", adminOnly: false },
  { name: "Inbox", href: "/dashboard/inbox", icon: "MessageSquare", adminOnly: false },
  { name: "Contacts", href: "/dashboard/contacts", icon: "Users", adminOnly: false },
  { name: "Channels", href: "/dashboard/channels", icon: "Plug", adminOnly: true },
  { name: "Agentes", href: "/dashboard/agents", icon: "Bot", adminOnly: false },
  { name: "Conocimiento", href: "/dashboard/knowledge", icon: "BookOpen", adminOnly: true },
  { name: "Settings", href: "/dashboard/settings", icon: "Settings", adminOnly: true },
];
