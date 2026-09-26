"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { NavLinks } from "@/components/sidebar";
import { ProfileMenu, type ProfileUser } from "@/components/profile-menu";
import { useDraftCounts, visibleDraftCount } from "@/components/drafts/use-draft-counts";
import type { PendingDraftCounts } from "@/lib/actions/agent-drafts";
import type { Database } from "@/lib/types/database";

type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];

/**
 * Lo que la barra superior necesita saber del workspace (F7).
 *
 * Antes en el celular habia DOS barras: la del layout (nombre del workspace,
 * menu y campana) y la de la pagina (titulo). Ahora hay una sola, la de la
 * pagina, y para poder dibujar el menu y la campana necesita estos datos. El
 * layout los deja en un contexto en vez de pasarlos pagina por pagina: son 22
 * pantallas y ninguna los usa para otra cosa.
 */
export interface DashboardChrome {
  workspace: Workspace;
  user: ProfileUser;
  workspaces: Array<{ id: string; name: string; slug: string; role: string }>;
  role: string;
  unreadNotifications: number;
  draftCounts?: PendingDraftCounts;
}

const ChromeContext = createContext<DashboardChrome | null>(null);

export function DashboardChromeProvider({
  value,
  children,
}: {
  value: DashboardChrome;
  children: ReactNode;
}) {
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

/**
 * Los datos del workspace para la barra.
 *
 * Devuelve null fuera del layout del dashboard (por ejemplo en un test o en una
 * pantalla suelta): la barra se dibuja igual, sin menu ni campana.
 */
export function useDashboardChrome(): DashboardChrome | null {
  return useContext(ChromeContext);
}

/**
 * El boton de menu del celular, con su cajon.
 *
 * Vivia en MobileTopBar. Ahora vive adentro de la barra de la pagina, que es
 * la unica que queda.
 */
export function MobileMenuButton({ chrome }: { chrome: DashboardChrome }) {
  const pathname = usePathname();
  // El menu queda abierto solo en la pantalla donde se abrio: cambiar de
  // pantalla (tambien con "atras") lo cierra sin un efecto.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (next: boolean) => setOpenAt(next ? pathname : null);
  const drafts = useDraftCounts(chrome.workspace.id, chrome.draftCounts, "mobile-drafts");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenAt(null);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir el menú"
        aria-expanded={open}
        className="-ml-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg hover:bg-accent md:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" aria-label="Cerrar el menú" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-sidebar shadow-xl">
            <div className="flex items-center gap-1 border-b border-sidebar-border px-2 py-2">
              <div className="min-w-0 flex-1">
                <WorkspaceSwitcher current={chrome.workspace} workspaces={chrome.workspaces} />
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar el menú"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              <NavLinks role={chrome.role} drafts={drafts} onNavigate={() => setOpen(false)} />
            </nav>
            <div className="border-t border-sidebar-border p-3">
              <ProfileMenu user={chrome.user} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * La campana y el numero de borradores, del lado derecho de la barra.
 *
 * Solo en el celular: en la computadora los dos viven al pie del menu lateral,
 * donde los dejo el rediseño del menu.
 */
export function MobileChromeActions({ chrome }: { chrome: DashboardChrome }) {
  const drafts = useDraftCounts(chrome.workspace.id, chrome.draftCounts, "mobile-drafts-actions");
  const waiting = visibleDraftCount(drafts);

  return (
    <div className="flex items-center gap-1 md:hidden">
      {waiting > 0 && (
        <Link
          href="/dashboard/drafts"
          aria-label={`${waiting} ${waiting === 1 ? "borrador esperando" : "borradores esperando"}. Ir a la cola`}
          className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-accent"
        >
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground">
            {waiting}
          </span>
        </Link>
      )}
      <NotificationBell workspaceId={chrome.workspace.id} initialUnread={chrome.unreadNotifications} />
    </div>
  );
}
