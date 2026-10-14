"use client";

import Link from "next/link";
import { LinkPending } from "@/components/ui/link-pending";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Clapperboard,
  GitBranch,
  Grid3x3,
  MessageSquare,
  Users,
  LayoutGrid,
  Bot,
  Settings,
  CalendarDays,
  PhoneCall,
  CircleDollarSign,
  ClipboardList,
  ListChecks,
  ListTodo,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { NAV_ITEMS, visibleNavItems, navSections, navItemTooltip, navItemHref, type NavFlag } from "@/lib/nav/items";
import { TOOLS_OPEN_KEY, activeInsideTools, toolsOpen } from "@/lib/nav/tools-open";

export type NavFlags = Partial<Record<NavFlag, boolean>>;
import { activeNavHref } from "@/lib/nav/active";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ProfileMenu, type ProfileUser } from "@/components/profile-menu";
import { useHtmlClass } from "@/components/use-html-class";
import { isAdminRole } from "@/lib/auth/roles";
import type { PendingDraftCounts } from "@/lib/actions/agent-drafts";
import { useDraftCounts } from "@/components/drafts/use-draft-counts";
import { draftsQueueHref } from "@/lib/agent/drafts/destination";
import type { Database } from "@/lib/types/database";

type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];

interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
  role: string;
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
// de Inbox (components/comunicacion/section-tabs.tsx). Channels ya no tiene
// item propio (D3): se llega desde el detalle de Zernio/Evolution en
// Integraciones (que hoy es una pestaña de Ajustes, no un item).
const ICONS: Record<string, LucideIcon> = {
  LayoutGrid, GitBranch, MessageSquare, Users, Bot, Settings,
  Clapperboard, Grid3x3, CalendarDays, PhoneCall, ClipboardList, CircleDollarSign, ListChecks, ListTodo,
};

export const navigation = NAV_ITEMS.map((item) => ({
  name: item.name,
  href: item.href,
  permissions: item.permissions,
  icon: ICONS[item.icon] ?? LayoutGrid,
  adminOnly: item.adminOnly,
  group: item.group,
  alsoActiveOn: item.alsoActiveOn,
  requires: item.requires,
}));

export function Sidebar({
  workspace,
  user,
  role,
  permissionKeys = [],
  workspaces,
  unreadNotifications = 0,
  draftCounts,
  navFlags,
}: {
  workspace: Workspace;
  user: ProfileUser;
  role: string;
  /** Claves del rol resuelto (Etapa 4): el menu filtra por permiso. */
  permissionKeys?: string[];
  workspaces: WorkspaceItem[];
  /** Conteo del servidor: evita que el numerito de la campana parpadee. */
  unreadNotifications?: number;
  /** Borradores esperando (Bloque 2c). Coincide con la vista por defecto de la cola: los mios. */
  draftCounts?: PendingDraftCounts;
  /** Condiciones del menú calculadas en el servidor ("Mi reporte del día"). */
  navFlags?: NavFlags;
}) {
  const drafts = useDraftCounts(workspace.id, draftCounts, "sidebar-drafts");
  const collapsed = useHtmlClass("sidebar-collapsed");

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

      {/*
        overflow-y-auto: con los titulos de grupo el menu es mas alto; en una
        pantalla baja scrollea en vez de cortarse.
      */}
      <nav className="flex flex-1 flex-col space-y-1 overflow-y-auto p-3 collapsed:px-2">
        <NavLinks role={role} permissionKeys={permissionKeys} navFlags={navFlags} drafts={drafts} collapsed={collapsed} />
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
        <ProfileMenu user={user} collapsed={collapsed} />
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
  permissionKeys = [],
  navFlags,
  drafts,
  onNavigate,
  collapsed = false,
}: {
  role: string;
  /** Las claves del rol resuelto (Etapa 4): filtran los items con `permissions`. */
  permissionKeys?: string[];
  /** Condiciones calculadas en el servidor (`requires` en lib/nav/items.ts). */
  navFlags?: NavFlags;
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
  const isAdmin = isAdminRole(role);
  const navItems = visibleNavItems(navigation, { isAdmin, permissionKeys, flags: navFlags });
  // El agrupamiento se calcula sobre los items YA filtrados: un grupo sin
  // nada visible no aparece, y con el su titulo (N1).
  const sections = navSections(navItems);
  // Se resuelve UNA sola vez, sobre todos los items visibles: asi, cuando dos
  // matchean (Ajustes y sus subrutas), gana el mas especifico en vez de
  // marcar los dos (N4).
  const activeHref = activeNavHref(pathname, navItems);
  // Herramientas (plano formularios-ui, F2): la preferencia vive como clase en el <html>, igual que el
  // colapso del menu (un script del <head> la aplica antes de pintar, sin parpadeo).
  const storedOpen = useHtmlClass(TOOLS_OPEN_KEY);
  const open = toolsOpen(storedOpen ? "1" : "0", activeHref);
  const activeInside = activeInsideTools(activeHref);

  function toggleTools() {
    const next = !storedOpen;
    document.documentElement.classList.toggle(TOOLS_OPEN_KEY, next);
    try {
      localStorage.setItem(TOOLS_OPEN_KEY, next ? "1" : "0");
    } catch {
      // Sin almacenamiento (ventana privada): la preferencia dura hasta recargar y nada mas.
    }
  }

  return (
    <>
      {sections.map((section) => {
        const itemsId = `nav-items-${section.group}`;
        return (
          <div key={section.group} className="mt-4 space-y-1 first:mt-0">
            {section.title && !section.collapsible && (
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/40 collapsed:hidden">
                {section.title}
              </div>
            )}
            {/* El titulo de una seccion colapsable es un boton: Tab llega, Enter o Espacio abren y cierran. */}
            {section.title && section.collapsible && (
              <button
                type="button"
                onClick={toggleTools}
                aria-expanded={open}
                aria-controls={itemsId}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-3 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide transition-colors hover:text-sidebar-foreground/70 collapsed:hidden",
                  activeInside ? "text-sidebar-foreground/70" : "text-sidebar-foreground/40",
                )}
              >
                {section.title}
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
              </button>
            )}
            {/*
              Colapsado (N3), los titulos de grupo no entran: se esconden
              (arriba) y en su lugar va esta linea fina.
            */}
            {section.separatorBefore && (
              <div className="hidden border-t border-sidebar-border pt-2 collapsed:-mt-1 collapsed:block" aria-hidden="true" />
            )}
            <div
              id={itemsId}
              // Una seccion colapsable se esconde con CSS (no con el estado de React) para que no parpadee al
              // cargar: abierta si la pantalla activa esta adentro, o si el <html> trae `nav-tools-open`. Con el
              // menu angosto (`collapsed:`) se ven todos los iconos.
              className={cn(
                "space-y-1",
                section.collapsible && !activeInside && "hidden tools-open:block collapsed:block",
              )}
            >
              {section.items.map((item) => {
                const isActive = item.href === activeHref;
                const badge = item.href === "/dashboard/inbox" && drafts ? drafts : null;
                return (
                  // El badge de borradores es un link propio y no puede vivir
                  // adentro del link de Inbox (anidar <a> es invalido y llevaria
                  // a la bandeja en vez de a la cola). Por eso la fila es un
                  // contenedor relativo.
                  <div key={item.name} className="relative">
                    <Link
                      href={navItemHref(item, { isAdmin })}
                      onClick={onNavigate}
                      aria-current={isActive ? "page" : undefined}
                      title={collapsed ? navItemTooltip(item) : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors md:min-h-0 collapsed:justify-center collapsed:gap-0 collapsed:px-0",
                        badge && "pr-14 collapsed:pr-0",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="collapsed:hidden">{item.name}</span>
                      <LinkPending className="ml-auto collapsed:hidden" />
                    </Link>
                    {badge && <DraftBadge counts={badge} onNavigate={onNavigate} />}
                  </div>
                );
              })}
            </div>
          </div>
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
export function DraftBadge({ counts, onNavigate }: { counts: PendingDraftCounts; onNavigate?: () => void }) {
  const total = counts.total ?? null;
  if (counts.mine === 0 && !total) return null;
  const title =
    total !== null
      ? `Borradores esperando: ${counts.mine} tuyos · ${total} en total${counts.unassigned ? ` (${counts.unassigned} sin asignar)` : ""}. Ir a la cola`
      : `Borradores esperando: ${counts.mine}. Ir a la cola`;
  const corto = counts.mine > 0 ? counts.mine : (total ?? 0);
  return (
    <Link
      href={draftsQueueHref(counts)}
      onClick={onNavigate}
      // Centrado sobre la fila de Inbox; con el menu colapsado, arriba a la
      // derecha del icono, donde hay lugar para un solo numero.
      className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-full collapsed:right-1 collapsed:top-1 collapsed:translate-y-0"
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
    </Link>
  );
}
