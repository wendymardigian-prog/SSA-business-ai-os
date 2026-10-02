"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { MessageSquare, Radio, ListOrdered, Sprout, type LucideIcon } from "lucide-react";
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
 * `aria-current="page"`. A 390 px no entran las cuatro con icono: el control
 * scrollea adentro (min-w-0 + overflow-x-auto) y los iconos aparecen desde `sm`.
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

  return (
    <nav
      aria-label="Secciones de comunicación"
      className="flex min-w-0 shrink items-center overflow-x-auto rounded-lg border border-border p-0.5"
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
  );
}
