"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Radio, ListOrdered, Sprout, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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

export function SectionTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Secciones de comunicación"
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-background px-3 py-1.5"
    >
      {COMUNICACION_TABS.map((tab) => {
        // startsWith y no igualdad: el detalle de una secuencia
        // (/dashboard/sequences/<id>) tiene que dejar marcada su pestaña.
        const isActive = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-9 shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            <tab.icon className="h-4 w-4" aria-hidden="true" />
            {tab.name}
          </Link>
        );
      })}
    </nav>
  );
}
