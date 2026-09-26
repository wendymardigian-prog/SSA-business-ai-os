/**
 * Ítems del menú lateral, como datos puros (F13). Es la fuente única del orden
 * y los nombres; el sidebar les pone el ícono. Testeable sin React.
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
  { name: "Broadcasts", href: "/dashboard/broadcasts", icon: "Radio", adminOnly: false },
  { name: "Sequences", href: "/dashboard/sequences", icon: "ListOrdered", adminOnly: false },
  { name: "Growth", href: "/dashboard/growth", icon: "Sprout", adminOnly: false },
  { name: "Channels", href: "/dashboard/channels", icon: "Plug", adminOnly: true },
  { name: "Agentes", href: "/dashboard/agents", icon: "Bot", adminOnly: false },
  { name: "Conocimiento", href: "/dashboard/knowledge", icon: "BookOpen", adminOnly: true },
  { name: "Integraciones", href: "/dashboard/settings/integrations", icon: "Blocks", adminOnly: true },
  { name: "Settings", href: "/dashboard/settings", icon: "Settings", adminOnly: true },
];
