"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  GitBranch,
  MessageSquare,
  Users,
  Radio,
  ListOrdered,
  BarChart3,
  Sprout,
  Plug,
  Blocks,
  BookOpen,
  Bot,
  Settings,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { isAdminRole } from "@/lib/auth/roles";
import type { PendingDraftCounts } from "@/lib/actions/agent-drafts";
import { useDraftCounts } from "@/components/drafts/use-draft-counts";
import type { Database } from "@/lib/types/database";

type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];

interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
  role: string;
}

function subscribeToThemeClass(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
}

// adminOnly: la pantalla ademas esta protegida por requireWorkspaceAdmin y por
// RLS. Ocultarla del menu es para no ofrecerle a un Member un link que rebota.
//
// Borradores NO esta en el menu (Bloque 2d): el modo borrador es una rampa para
// confiar en el agente, no una seccion permanente. El dia que un canal vuelve a
// envio directo, el item quedaria para siempre apuntando a una pantalla vacia.
// La cola (/dashboard/drafts) sigue existiendo y se llega por el numero sobre
// Inbox, la pestana de la bandeja, el chip de cada conversacion y los avisos.
export const navigation = [
  { name: "Flows", href: "/dashboard/flows", icon: GitBranch, adminOnly: false },
  { name: "Inbox", href: "/dashboard/inbox", icon: MessageSquare, adminOnly: false },
  { name: "Contacts", href: "/dashboard/contacts", icon: Users, adminOnly: false },
  { name: "Broadcasts", href: "/dashboard/broadcasts", icon: Radio, adminOnly: false },
  { name: "Sequences", href: "/dashboard/sequences", icon: ListOrdered, adminOnly: false },
  { name: "Analytics", href: "/dashboard/analytics", icon: BarChart3, adminOnly: false },
  { name: "Growth", href: "/dashboard/growth", icon: Sprout, adminOnly: false },
  { name: "Channels", href: "/dashboard/channels", icon: Plug, adminOnly: true },
  // Un Member entra a ver los runs y las acciones de sus conversaciones.
  { name: "Agentes", href: "/dashboard/agents", icon: Bot, adminOnly: false },
  {
    name: "Conocimiento",
    href: "/dashboard/knowledge",
    icon: BookOpen,
    adminOnly: true,
  },
  { name: "Integraciones", href: "/dashboard/settings/integrations", icon: Blocks, adminOnly: true },
  { name: "Settings", href: "/dashboard/settings", icon: Settings, adminOnly: true },
];

export function Sidebar({
  workspace,
  role,
  workspaces,
  unreadNotifications = 0,
  draftCounts,
}: {
  workspace: Workspace;
  user: { id: string; email?: string };
  role: string;
  workspaces: WorkspaceItem[];
  /** Conteo del servidor: evita que el numerito de la campana parpadee. */
  unreadNotifications?: number;
  /** Borradores esperando (Bloque 2c). Coincide con la vista por defecto de la cola: los mios. */
  draftCounts?: PendingDraftCounts;
}) {
  const router = useRouter();
  const supabase = createClient();
  const drafts = useDraftCounts(workspace.id, draftCounts, "sidebar-drafts");
  const dark = useSyncExternalStore(
    subscribeToThemeClass,
    () => document.documentElement.classList.contains("dark"),
    () => false
  );

  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    // En el telefono el menu vive en la barra de arriba (mobile-top-bar.tsx).
    <div className="hidden h-full w-60 flex-shrink-0 flex-col border-r border-border bg-sidebar md:flex">
      <div className="flex items-center gap-1 border-b border-sidebar-border px-3 py-3">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
        </div>
        {/*
          La campana va aca y no en un item del menu: tiene que estar visible en
          todas las pantallas, y esta es la unica banda persistente que hay (el
          layout no tiene topbar).
        */}
        <NotificationBell workspaceId={workspace.id} initialUnread={unreadNotifications} />
      </div>

      <nav className="flex-1 space-y-1 p-3">
        <NavLinks role={role} drafts={drafts} />
      </nav>

      <div className="border-t border-sidebar-border p-3 space-y-1">
        <button
          onClick={toggleTheme}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {dark ? "Light mode" : "Dark mode"}
        </button>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

/**
 * Los items del menu. Los usa el menu lateral y el panel del telefono: una
 * sola lista, para que los dos no se desincronicen.
 */
export function NavLinks({
  role,
  drafts,
  onNavigate,
}: {
  role: string;
  drafts: PendingDraftCounts | undefined;
  /** El panel del telefono se cierra al elegir. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const navItems = navigation.filter((item) => !item.adminOnly || isAdminRole(role));
  return (
    <>
      {navItems.map((item) => {
        // La cola de borradores cuelga de Inbox: estando ahi, Inbox queda marcado.
        const isActive =
          pathname.startsWith(item.href) || (item.href === "/dashboard/inbox" && pathname.startsWith("/dashboard/drafts"));
        return (
          <Link
            key={item.name}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors md:min-h-0",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.name}
            {item.href === "/dashboard/inbox" && drafts && <DraftBadge counts={drafts} />}
          </Link>
        );
      })}
    </>
  );
}

/**
 * Los borradores esperando, sobre Inbox (Bloque 2d). El numero grande son los
 * mios (lo que muestra la cola por defecto); para Owner/Admin, al lado, el
 * total del workspace: un Owner sin contactos propios no puede ver "0" con
 * doce esperando. Con cero no se muestra nada: el numero desaparece solo
 * cuando ningun canal deja borradores.
 */
export function DraftBadge({ counts }: { counts: PendingDraftCounts }) {
  const total = counts.total ?? null;
  if (counts.mine === 0 && !total) return null;
  const title =
    total !== null
      ? `Borradores esperando: ${counts.mine} tuyos · ${total} en total${counts.unassigned ? ` (${counts.unassigned} sin asignar)` : ""}`
      : `Borradores esperando: ${counts.mine}`;
  return (
    <span className="ml-auto flex items-center gap-1" title={title} aria-label={title}>
      {counts.mine > 0 && (
        <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">{counts.mine}</span>
      )}
      {total !== null && total > counts.mine && (
        <span className={cn(counts.mine > 0 ? "text-[10px] text-sidebar-foreground/60" : "rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary")}>
          {counts.mine > 0 ? `· ${total}` : total}
        </span>
      )}
    </span>
  );
}
