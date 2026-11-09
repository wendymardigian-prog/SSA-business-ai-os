"use client";

import Link from "next/link";
import { LinkPending } from "@/components/ui/link-pending";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Clapperboard,
  GitBranch,
  Grid3x3,
  Megaphone,
  MessageSquare,
  Users,
  LayoutGrid,
  Bot,
  Settings,
  Sparkles,
  CalendarDays,
  PhoneCall,
  CircleDollarSign,
  Wallet,
  ClipboardList,
  ListChecks,
  ListTodo,
  GraduationCap, // @plantilla-quitar(servicios)
  AppWindow, // @plantilla-quitar(servicios)
  Handshake, // @plantilla-quitar(ventas)
  ChevronDown,
  Pin,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  NAV_ITEMS,
  visibleNavItems,
  navSections,
  navItemTooltip,
  navItemHref,
  sectionTitleTarget,
  type NavFavorites,
  type NavFlag,
  type NavGroupId,
} from "@/lib/nav/items";
import { SECTION_HIDDEN_CLASS, SECTION_OPEN_PREFIX, activeSectionGroup, sectionOpen, sectionOpenKey } from "@/lib/nav/sections-open";
import { setNavFavorite } from "@/lib/actions/nav-favorites";

export type NavFlags = Partial<Record<NavFlag, boolean>>;
import { activeNavHref } from "@/lib/nav/active";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher, type WorkspaceItem } from "@/components/workspace-switcher";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ProfileMenu, type ProfileUser } from "@/components/profile-menu";
import { useHtmlClass, useHtmlClassesWithPrefix } from "@/components/use-html-class";
import { setSharedNavFavorites, useNavFavorites } from "@/components/nav-favorites-store";
import type { PendingDraftCounts } from "@/lib/agent/drafts/pending-count";
import { useDraftCounts } from "@/components/drafts/use-draft-counts";
import { draftsQueueHref } from "@/lib/agent/drafts/destination";
import type { Database } from "@/lib/types/database";

type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];


// Cada item pide el permiso de lo que abre (lib/nav/items.ts): la pantalla ademas se protege
// con su guard y con la RLS. Ocultarla del menu es para no ofrecer un link que rebota.
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
  Clapperboard, Grid3x3, Megaphone, CalendarDays, PhoneCall, ClipboardList, CircleDollarSign, Wallet, ListChecks, ListTodo, Sparkles,
  GraduationCap, // @plantilla-quitar(servicios)
  AppWindow, // @plantilla-quitar(servicios)
  Handshake, // @plantilla-quitar(ventas)
};

export const navigation = NAV_ITEMS.map((item) => ({
  name: item.name,
  href: item.href,
  permissions: item.permissions,
  icon: ICONS[item.icon] ?? LayoutGrid,
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
  navFavorites,
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
  /** Condiciones del menú calculadas en el servidor. */
  navFlags?: NavFlags;
  /** La pantalla favorita de cada seccion (00357), leida en el servidor: el pin se dibuja sin parpadeo. */
  navFavorites?: NavFavorites;
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
        <NavLinks role={role} permissionKeys={permissionKeys} navFlags={navFlags} navFavorites={navFavorites} drafts={drafts} collapsed={collapsed} />
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
        <ProfileMenu user={user} collapsed={collapsed} showMyLinks={(permissionKeys ?? []).includes("affiliates.use")} />
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
  navFavorites,
  drafts,
  onNavigate,
  collapsed = false,
}: {
  role: string;
  /** Las claves del rol resuelto (Etapa 4): filtran los items con `permissions`. */
  permissionKeys?: string[];
  /** Condiciones calculadas en el servidor (`requires` en lib/nav/items.ts). */
  navFlags?: NavFlags;
  /** La pantalla favorita de cada seccion (00357), leida en el servidor. */
  navFavorites?: NavFavorites;
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
  const viewer = { permissionKeys: permissionKeys ?? [] };
  const navItems = visibleNavItems(navigation, { permissionKeys: viewer.permissionKeys, flags: navFlags });
  // El agrupamiento se calcula sobre los items YA filtrados: un grupo sin
  // nada visible no aparece, y con el su titulo (N1).
  const sections = navSections(navItems);
  // Se resuelve UNA sola vez, sobre todos los items visibles: asi, cuando dos
  // matchean (Ajustes y sus subrutas), gana el mas especifico en vez de
  // marcar los dos (N4).
  const activeHref = activeNavHref(pathname, navItems);
  const activeGroup = activeSectionGroup(activeHref);
  // Que secciones estan abiertas: la preferencia vive como clase en el <html> (`nav-open-<grupo>`), igual
  // que el colapso del menu (un script del <head> la aplica antes de pintar, sin parpadeo).
  const openClasses = useHtmlClassesWithPrefix(SECTION_OPEN_PREFIX).split(" ");
  const favorites = useNavFavorites(navFavorites ?? {});
  const [pinError, setPinError] = useState<{ group: NavGroupId; message: string } | null>(null);
  // Los cambios de favorita se guardan de a uno y en orden: dos clicks rapidos no se pisan.
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  // Ya hidrato: antes de esto (el HTML del servidor y el primer render del navegador) la seccion de la pantalla
  // activa se dibuja abierta aunque el <html> no traiga su clase, para que no parpadee.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  /**
   * Entrar a una pantalla deja su seccion abierta Y guardada (9/11/2026). Antes se veia abierta solo mientras la
   * pantalla estaba adentro: al pasar a otra seccion, la anterior se cerraba sola y parecia que abrir una cerraba
   * otra. Ahora cada seccion se cierra solo con su flechita, tambien la de la pantalla activa. useLayoutEffect:
   * la clase se pone antes de pintar.
   */
  useLayoutEffect(() => {
    if (activeGroup) setSectionOpen(activeGroup, true);
  }, [activeGroup]);

  function togglePin(group: NavGroupId, href: string) {
    const previous = favorites;
    const isFavorite = previous[group] === href;
    const next: NavFavorites = { ...previous };
    if (isFavorite) delete next[group];
    else next[group] = href;
    // Optimista: se ve enseguida; si falla, vuelve a lo anterior y lo dice debajo del titulo.
    setSharedNavFavorites(next);
    setPinError(null);
    saveChain.current = saveChain.current.then(async () => {
      try {
        const result = await setNavFavorite({ group, href: isFavorite ? null : href, browserTimezone: browserTimezone() });
        if (result.ok) return;
        setSharedNavFavorites(previous);
        setPinError({ group, message: result.error });
      } catch {
        setSharedNavFavorites(previous);
        setPinError({ group, message: "No pude guardar la favorita. Probá de nuevo." });
      }
    });
  }

  return (
    <>
      {sections.map((section) => {
        const itemsId = `nav-items-${section.group}`;
        const activeInside = activeGroup === section.group;
        // Abierta = su clase en el <html>. Antes de hidratar vale tambien la regla de la pantalla activa (`sectionOpen`).
        const classOpen = openClasses.includes(sectionOpenKey(section.group));
        const isOpen = section.collapsible && (hydrated ? classOpen : sectionOpen(section.group, classOpen ? "1" : "0", activeHref));
        const target = sectionTitleTarget(section, favorites, viewer);
        const favorite = favorites[section.group];
        const favoriteName = target ? section.items.find((i) => i.href === favorite)?.name : undefined;
        return (
          <div key={section.group} className="mt-4 space-y-1 first:mt-0">
            {section.title && !section.collapsible && (
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/40 collapsed:hidden">
                {section.title}
              </div>
            )}
            {/*
              El encabezado de una seccion colapsable tiene dos zonas (9/11/2026):
              - La flechita SOLO abre o cierra (nunca navega).
              - El resto: con favorita, es un link a ella (y deja la seccion abierta); sin favorita, abre o cierra.
              Son dos controles separados (no uno adentro del otro): Tab llega a cada uno.
            */}
            {section.title && section.collapsible && (
              <div
                className={cn(
                  "flex items-center rounded-md text-[11px] font-semibold uppercase tracking-wide collapsed:hidden",
                  activeInside ? "text-sidebar-foreground/70" : "text-sidebar-foreground/40",
                )}
              >
                {target ? (
                  <Link
                    href={target}
                    onClick={() => {
                      setSectionOpen(section.group, true);
                      onNavigate?.();
                    }}
                    title={`Ir a ${favoriteName ?? "la favorita"}`}
                    className="min-w-0 flex-1 truncate rounded-md px-3 pb-1 pt-0.5 transition-colors hover:text-sidebar-foreground/70"
                  >
                    {section.title}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSectionOpen(section.group, !isOpen)}
                    aria-expanded={isOpen}
                    aria-controls={itemsId}
                    className="min-w-0 flex-1 truncate rounded-md px-3 pb-1 pt-0.5 text-left transition-colors hover:text-sidebar-foreground/70"
                  >
                    {section.title}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSectionOpen(section.group, !isOpen)}
                  aria-expanded={isOpen}
                  aria-controls={itemsId}
                  aria-label={isOpen ? `Cerrar ${section.title}` : `Abrir ${section.title}`}
                  title={isOpen ? `Cerrar ${section.title}` : `Abrir ${section.title}`}
                  className="mr-1.5 flex h-6 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-sidebar-border/60 hover:text-sidebar-foreground/70"
                >
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} aria-hidden />
                </button>
              </div>
            )}
            {/*
              Colapsado (N3), los titulos de grupo no entran: se esconden
              (arriba) y en su lugar va esta linea fina.
            */}
            {section.separatorBefore && (
              <div className="hidden border-t border-sidebar-border pt-2 collapsed:-mt-1 collapsed:block" aria-hidden="true" />
            )}
            {pinError?.group === section.group && (
              <p role="status" className="px-3 text-xs text-destructive collapsed:hidden">
                {pinError.message}
              </p>
            )}
            <div
              id={itemsId}
              // Una seccion colapsable se esconde con CSS (no con el estado de React) para que no parpadee al
              // cargar: abierta si el <html> trae `nav-open-<grupo>` (y, hasta hidratar, si la pantalla activa esta
              // adentro). Las secciones son independientes: abrir una nunca cierra otra. Con el menu angosto
              // (`collapsed:`) se ven todos los iconos.
              className={cn("space-y-1", section.collapsible && !(activeInside && !hydrated) && SECTION_HIDDEN_CLASS[section.group])}
            >
              {section.items.map((item) => {
                const isActive = item.href === activeHref;
                const badge = item.href === "/dashboard/inbox" && drafts ? drafts : null;
                const isFavorite = section.collapsible && favorite === item.href;
                return (
                  // El badge de borradores y el pin son botones o links propios y no pueden vivir adentro
                  // del link del item (anidar <a> o <button> en <a> es invalido). Por eso la fila es un
                  // contenedor relativo.
                  <div key={item.name} className="group/nav relative">
                    <Link
                      href={navItemHref(item, viewer)}
                      onClick={onNavigate}
                      aria-current={isActive ? "page" : undefined}
                      title={collapsed ? navItemTooltip(item) : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors md:min-h-0 collapsed:justify-center collapsed:gap-0 collapsed:px-0",
                        badge && "pr-14 collapsed:pr-0",
                        section.collapsible && "pr-10 collapsed:pr-0",
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
                    {section.collapsible && section.title && (
                      <PinButton
                        itemName={item.name}
                        sectionTitle={section.title}
                        pinned={isFavorite}
                        onToggle={() => togglePin(section.group, item.href)}
                      />
                    )}
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

/** Guarda si una seccion se ve abierta: clase del <html> + localStorage (sin parpadeo al recargar). */
function setSectionOpen(group: NavGroupId, open: boolean) {
  const key = sectionOpenKey(group);
  document.documentElement.classList.toggle(key, open);
  try {
    localStorage.setItem(key, open ? "1" : "0");
  } catch {
    // Sin almacenamiento (ventana privada): la preferencia dura hasta recargar y nada mas.
  }
}

function noopSubscribe() {
  return () => {};
}

function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/**
 * La chincheta de un item: lo marca (o desmarca) como la pantalla favorita de su seccion. En la
 * computadora aparece al pasar el mouse o con el teclado; la favorita se ve siempre. En el panel del
 * telefono (sin mouse) se ve tenue siempre. Con el menu angosto no se muestra.
 */
function PinButton({
  itemName,
  sectionTitle,
  pinned,
  onToggle,
}: {
  itemName: string;
  sectionTitle: string;
  pinned: boolean;
  onToggle: () => void;
}) {
  const label = pinned ? `Quitar ${itemName} como favorita de ${sectionTitle}` : `Marcar ${itemName} como favorita de ${sectionTitle}`;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={pinned}
      aria-label={label}
      title={label}
      className={cn(
        "absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md transition-opacity hover:bg-sidebar-border/60 focus-visible:opacity-100 collapsed:hidden",
        pinned
          ? "text-sidebar-foreground/80 opacity-100"
          : "text-sidebar-foreground/50 opacity-40 md:opacity-0 md:group-hover/nav:opacity-100",
      )}
    >
      <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} aria-hidden />
    </button>
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
          <span className={cn(counts.mine > 0 ? "text-[10px] text-sidebar-foreground/60" : "rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-ink")}>
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
