"use client";

import { useEffect, useState } from "react";
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
 * La barra de arriba en el telefono (Bloque 2d).
 *
 * Toda la logica de ventanas del modo borrador existe porque hay presion de
 * tiempo, y la presion de tiempo cae cuando la persona no esta en la
 * computadora. Un borrador con tres horas de ventana un domingo a la tarde se
 * aprueba desde el telefono o no se aprueba. Por eso en mobile el menu lateral
 * (240 px fijos) se esconde y queda esta barra: la campana, el numero de
 * borradores esperando (lleva directo a la cola) y el menu desplegable.
 */

export function MobileTopBar({
  workspace,
  user,
  workspaces,
  role,
  unreadNotifications,
  draftCounts,
}: {
  workspace: Workspace;
  user: ProfileUser;
  workspaces: Array<{ id: string; name: string; slug: string; role: string }>;
  role: string;
  unreadNotifications: number;
  draftCounts?: PendingDraftCounts;
}) {
  const pathname = usePathname();
  // El menu queda abierto solo en la pantalla donde se abrio: cambiar de
  // pantalla (tambien con el boton "atras") lo cierra sin un efecto.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (next: boolean) => setOpenAt(next ? pathname : null);
  const drafts = useDraftCounts(workspace.id, draftCounts, "mobile-drafts");
  const waiting = visibleDraftCount(drafts);

  // Escape cierra; con el menu abierto el fondo no scrollea.
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
      <header className="flex h-14 flex-shrink-0 items-center gap-1 border-b border-border bg-sidebar px-2 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir el menú"
          aria-expanded={open}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-sidebar-foreground/80 hover:bg-sidebar-accent"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{workspace.name}</p>
        {waiting > 0 && (
          <Link
            href="/dashboard/drafts"
            aria-label={`${waiting} ${waiting === 1 ? "borrador esperando" : "borradores esperando"}. Ir a la cola`}
            className="flex h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-sidebar-accent"
          >
            Borradores
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground">{waiting}</span>
          </Link>
        )}
        <NotificationBell workspaceId={workspace.id} initialUnread={unreadNotifications} />
      </header>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" aria-label="Cerrar el menú" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-sidebar shadow-xl">
            <div className="flex items-center gap-1 border-b border-sidebar-border px-2 py-2">
              <div className="min-w-0 flex-1">
                <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
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
              <NavLinks role={role} drafts={drafts} onNavigate={() => setOpen(false)} />
            </nav>
            {/*
              El mismo boton de perfil que el menu de escritorio, para no tener
              dos pies distintos. Aca nunca esta colapsado.
            */}
            <div className="border-t border-sidebar-border p-3">
              <ProfileMenu user={user} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
