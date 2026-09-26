"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import type { LucideIcon } from "lucide-react";
import {
  GitBranch,
  MessageSquare,
  Users,
  LayoutGrid,
  Plug,
  BookOpen,
  Bot,
  Settings,
  LogOut,
  Moon,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav/items";
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

/**
 * Las dos preferencias que viven como clase en el <html>: el tema y el menu
 * colapsado. Se leen de ahi y no de un estado propio porque el script del
 * <head> (app/layout.tsx) ya las aplico antes del primer pintado; el
 * componente solo se entera de cual es.
 */
function subscribeToHtmlClass(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function useHtmlClass(name: string) {
  return useSyncExternalStore(
    subscribeToHtmlClass,
    () => document.documentElement.classList.contains(name),
    () => false
  );
}

// adminOnly: la pantalla ademas esta protegida por requireWorkspaceAdmin y por
// RLS. Ocultarla del menu es para no ofrecerle a un Member un link que rebota.
//
// Borradores NO esta en el menu (Bloque 2d): el modo borrador es una rampa para
// confiar en el agente, no una seccion permanente. El dia que un canal vuelve a
// envio directo, el item quedaria para siempre apuntando a una pantalla vacia.
// La cola (/dashboard/drafts) sigue existiendo y se llega por el numero sobre
// Inbox, la pestana de la bandeja, el chip de cada conversacion y los avisos.
//
// Radio, ListOrdered y Sprout ya no estan aca: se mudaron a las sub-pestañas
// de Inbox (components/comunicacion/section-tabs.tsx). Blocks era de
// Integraciones, que ahora se llega desde Settings.
const ICONS: Record<string, LucideIcon> = {
  LayoutGrid, GitBranch, MessageSquare, Users, Plug, Bot, BookOpen, Settings,
};

export const navigation = NAV_ITEMS.map((item) => ({
  name: item.name,
  href: item.href,
  icon: ICONS[item.icon] ?? LayoutGrid,
  adminOnly: item.adminOnly,
}));

export function Sidebar({
  workspace,
  user,
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
  const dark = useHtmlClass("dark");
  const collapsed = useHtmlClass("sidebar-collapsed");

  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  /**
   * Colapsar es una preferencia, no un estado de pantalla: quien trabaja todo
   * el dia en la bandeja quiere la pantalla entera y no quiere volver a
   * achicar el menu cada vez que entra. Por eso se guarda.
   *
   * Lo que se guarda es la clase en el <html>, no un estado de React: asi el
   * script del <head> la puede aplicar al cargar, antes de que React exista.
   */
  function toggleCollapsed() {
    const next = !collapsed;
    document.documentElement.classList.toggle("sidebar-collapsed", next);
    localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    // En el telefono el menu vive en la barra de arriba (mobile-top-bar.tsx).
    // data-sidebar="desktop" es lo que habilita la variante `collapsed:` (ver
    // app/globals.css): las clases collapsed solo valen adentro de este menu.
    <div
      data-sidebar="desktop"
      className="hidden h-full w-60 flex-shrink-0 flex-col border-r border-border bg-sidebar transition-[width] md:flex collapsed:w-16"
    >
      <div className="flex items-center gap-1 border-b border-sidebar-border px-3 py-3 collapsed:justify-center collapsed:px-2">
        {/*
          Colapsado el cambiador de workspace se esconde entero y no solo su
          nombre: en 64 px de ancho un avatar con un chevron al lado no se lee
          como un boton, se lee como un adorno. Para cambiar de workspace se
          expande el menu.
        */}
        <div className="min-w-0 flex-1 collapsed:hidden">
          <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expandir el menú" : "Colapsar el menú"}
          title={collapsed ? "Expandir el menú" : "Colapsar el menú"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {/*
            Los dos iconos van siempre en el HTML y se elige por CSS, no por
            JavaScript: al cargar la pagina el estado colapsado ya esta puesto
            como clase, y asi el boton no muestra la flecha al reves durante el
            instante que tarda React en hidratar.
          */}
          <PanelLeftClose className="h-4 w-4 collapsed:hidden" aria-hidden="true" />
          <PanelLeftOpen className="hidden h-4 w-4 collapsed:block" aria-hidden="true" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 p-3 collapsed:px-2">
        <NavLinks role={role} drafts={drafts} collapsed={collapsed} />
      </nav>

      <div className="space-y-1 border-t border-sidebar-border p-3 collapsed:px-2">
        {/*
          La campana vive en el pie y no en la banda de arriba: tiene que estar
          visible en todas las pantallas, y el pie es tan persistente como la
          banda. Ahi arriba ahora esta el boton de colapsar.
        */}
        <NotificationBell
          workspaceId={workspace.id}
          initialUnread={unreadNotifications}
          variant="row"
          placement="up"
        />
        <button
          onClick={toggleTheme}
          title={collapsed ? (dark ? "Light mode" : "Dark mode") : undefined}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground collapsed:justify-center collapsed:gap-0 collapsed:px-0"
        >
          {dark ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
          <span className="collapsed:hidden">{dark ? "Light mode" : "Dark mode"}</span>
        </button>
        <button
          onClick={handleSignOut}
          title={collapsed ? "Sign out" : undefined}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground collapsed:justify-center collapsed:gap-0 collapsed:px-0"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span className="collapsed:hidden">Sign out</span>
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
  collapsed = false,
}: {
  role: string;
  drafts: PendingDraftCounts | undefined;
  /** El panel del telefono se cierra al elegir. */
  onNavigate?: () => void;
  /**
   * Menu colapsado (solo escritorio). El texto lo esconde la variante CSS
   * `collapsed:` —asi no parpadea al cargar—; lo que necesita saberlo en
   * JavaScript es el title, que es lo unico que le queda a quien navega con
   * el mouse para saber a donde va cada icono.
   */
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const navItems = navigation.filter((item) => !item.adminOnly || isAdminRole(role));
  return (
    <>
      {navItems.map((item) => {
        // La cola de borradores cuelga de Inbox: estando ahi, Inbox queda marcado.
        // Broadcasts, Sequences y Growth son sub-pestañas de Inbox, asi que
        // tambien lo dejan marcado (las cuatro son la misma seccion).
        const isActive =
          pathname.startsWith(item.href) ||
          (item.href === "/dashboard/inbox" &&
            ["/dashboard/drafts", "/dashboard/broadcasts", "/dashboard/sequences", "/dashboard/growth"].some((href) =>
              pathname.startsWith(href),
            ));
        return (
          <Link
            key={item.name}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            title={collapsed ? item.name : undefined}
            className={cn(
              "relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors md:min-h-0 collapsed:justify-center collapsed:gap-0 collapsed:px-0",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="collapsed:hidden">{item.name}</span>
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
 *
 * Con el menu colapsado no hay lugar para dos numeros al costado del texto,
 * asi que queda uno solo, chico, arriba a la derecha del icono. El texto
 * completo sigue en el title.
 */
export function DraftBadge({ counts }: { counts: PendingDraftCounts }) {
  const total = counts.total ?? null;
  if (counts.mine === 0 && !total) return null;
  const title =
    total !== null
      ? `Borradores esperando: ${counts.mine} tuyos · ${total} en total${counts.unassigned ? ` (${counts.unassigned} sin asignar)` : ""}`
      : `Borradores esperando: ${counts.mine}`;
  const corto = counts.mine > 0 ? counts.mine : (total ?? 0);
  return (
    <span
      className="ml-auto flex items-center gap-1 collapsed:absolute collapsed:right-1 collapsed:top-1 collapsed:ml-0"
      title={title}
      aria-label={title}
    >
      <span className="flex items-center gap-1 collapsed:hidden">
        {counts.mine > 0 && (
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">{counts.mine}</span>
        )}
        {total !== null && total > counts.mine && (
          <span className={cn(counts.mine > 0 ? "text-[10px] text-sidebar-foreground/60" : "rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary")}>
            {counts.mine > 0 ? `· ${total}` : total}
          </span>
        )}
      </span>
      <span className="hidden h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground collapsed:flex">
        {corto > 9 ? "9+" : corto}
      </span>
    </span>
  );
}
