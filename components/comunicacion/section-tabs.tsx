"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, MessageSquare, Radio, ListOrdered, Sprout, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  comunicacionTabHref,
  isTabActive,
  INBOX_HREF,
  INBOX_QUERY_STORAGE_KEY,
} from "@/lib/comunicacion/tab-href";

/**
 * Las sub-pestañas de comunicacion.
 *
 * Inbox dejo de ser una pantalla y paso a ser el hub: las conversaciones, los
 * broadcasts, las secuencias y growth son todas formas de hablarle a un
 * contacto, asi que viven juntas y se cambia entre ellas sin volver al menu.
 *
 * Las URLs no cambiaron. Las cuatro carpetas viven en el route group
 * app/(dashboard)/dashboard/(comunicacion)/, y los parentesis no entran en la
 * ruta: /dashboard/inbox sigue siendo /dashboard/inbox.
 *
 * Bloque I (I2): van en la barra superior, en el `left` del `PageHeader`, como
 * segmented control (el patron de `components/content/view-switcher.tsx`).
 * Son links y no botones: cambian de pantalla, y la activa se anuncia con
 * `aria-current="page"`.
 *
 * Debajo del breakpoint `topbar` (860 px) no entran junto al titulo y a los
 * botones del celular: ahi se muestra UN boton con la seccion activa que abre
 * un menu con las cuatro (`SectionTabsDropdown`). Arriba de 860 px siguen
 * siendo pestañas.
 */

interface Tab {
  name: string;
  href: string;
  icon: LucideIcon;
}

export const COMUNICACION_TABS: Tab[] = [
  { name: "Conversaciones", href: "/dashboard/inbox", icon: MessageSquare },
  { name: "Broadcasts", href: "/dashboard/broadcasts", icon: Radio },
  { name: "Sequences", href: "/dashboard/sequences", icon: ListOrdered },
  { name: "Growth", href: "/dashboard/growth", icon: Sprout },
];

function readRememberedInboxQuery(): string | null {
  try {
    return window.sessionStorage.getItem(INBOX_QUERY_STORAGE_KEY);
  } catch {
    // Navegacion privada o almacenamiento bloqueado: se vuelve sin filtros.
    return null;
  }
}

// sessionStorage no avisa cambios dentro de la misma pestaña, y no hace falta:
// cada seccion es otra pagina, asi que las pestañas se montan de nuevo y leen.
const noSubscription = () => () => {};

export function SectionTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.toString();
  const onInbox = isTabActive(INBOX_HREF, pathname);

  // La query de la Bandeja se recuerda al mirarla. Se lee con
  // useSyncExternalStore: en el servidor no hay sessionStorage (null), y asi el
  // primer render del cliente coincide y no hay error de hidratacion.
  const remembered = useSyncExternalStore(noSubscription, readRememberedInboxQuery, () => null);
  useEffect(() => {
    if (!onInbox) return;
    try {
      window.sessionStorage.setItem(INBOX_QUERY_STORAGE_KEY, currentQuery);
    } catch {
      // Sin almacenamiento, volver a Conversaciones la abre sin filtros. Nada mas.
    }
  }, [onInbox, currentQuery]);

  // A 390 px entran una o dos pestañas: la activa se trae a la vista, si no en
  // Broadcasts se veria "Conversaciones" y la marcada quedaria escondida. Se
  // mueve el scroll del control y no la pagina (scrollIntoView movería todo).
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
  }, [pathname]);

  const hrefFor = (tab: Tab) => comunicacionTabHref(tab.href, pathname, currentQuery, remembered);

  return (
    <>
    <SectionTabsDropdown pathname={pathname} hrefFor={hrefFor} />
    <nav
      ref={navRef}
      aria-label="Secciones de comunicación"
      className="relative hidden min-w-0 shrink items-center overflow-x-auto rounded-lg border border-border p-0.5 topbar:flex"
    >
      {COMUNICACION_TABS.map((tab) => {
        // startsWith y no igualdad: el detalle de una secuencia
        // (/dashboard/sequences/<id>) tiene que dejar marcada su pestaña.
        const isActive = isTabActive(tab.href, pathname);
        return (
          <Link
            key={tab.href}
            href={comunicacionTabHref(tab.href, pathname, currentQuery, remembered)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-sm transition-colors",
              isActive
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <tab.icon className="hidden h-4 w-4 sm:block" aria-hidden="true" />
            {tab.name}
          </Link>
        );
      })}
    </nav>
    </>
  );
}

/**
 * El selector de seccion para pantallas chicas: un boton con la seccion activa
 * (icono y nombre) y un menu con todas. Se abre con un toque, cierra con Esc,
 * con un toque afuera o al elegir, y se recorre con las flechas.
 */
function SectionTabsDropdown({ pathname, hrefFor }: { pathname: string; hrefFor: (tab: Tab) => string }) {
  const menuId = useId();
  // El menu se abre "en" una ruta: al cambiar de seccion deja de coincidir y se cierra solo.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === "function" ? value(open) : value;
    setOpenAt(next ? pathname : null);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const active = COMUNICACION_TABS.find((tab) => isTabActive(tab.href, pathname)) ?? COMUNICACION_TABS[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function focusItem(delta: number | "first" | "last") {
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = delta === "first" ? 0 : delta === "last" ? items.length - 1 : (current + delta + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div
      ref={rootRef}
      className="relative topbar:hidden"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          if (!open) setOpen(true);
          requestAnimationFrame(() => focusItem(open ? 1 : "first"));
        } else if (event.key === "ArrowUp" && open) {
          event.preventDefault();
          focusItem(-1);
        } else if (event.key === "Home" && open) {
          event.preventDefault();
          focusItem("first");
        } else if (event.key === "End" && open) {
          event.preventDefault();
          focusItem("last");
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Sección: ${active.name}. Cambiar de sección`}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm font-medium hover:bg-accent/50"
      >
        <active.icon className="h-4 w-4" aria-hidden="true" />
        <span className="max-w-[9rem] truncate">{active.name}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Secciones de comunicación"
          className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-border bg-popover p-1 shadow-lg"
        >
          {COMUNICACION_TABS.map((tab) => {
            const isActive = tab.href === active.href;
            return (
              <Link
                key={tab.href}
                role="menuitem"
                href={hrefFor(tab)}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex h-11 items-center gap-2.5 rounded-lg px-3 text-sm hover:bg-accent focus:bg-accent focus:outline-none",
                  isActive && "bg-accent/60 font-medium",
                )}
              >
                <tab.icon className="h-4 w-4" aria-hidden="true" />
                {tab.name}
                {isActive && <span className="ml-auto text-xs text-muted-foreground">Actual</span>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
