"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Las pestañas de Ajustes.
 *
 * Antes era una sola pagina larga con todo apilado y las secciones de equipo,
 * roles e integraciones eran tarjetas con un link. Como pestañas, cada cosa
 * tiene su lugar y se llega en un clic.
 *
 * Son links y no estado: cada pestaña ya era una ruta propia, y asi se pueden
 * abrir en otra ventana y el navegador las precarga.
 *
 * "Equipo y roles" queda marcada tambien en /settings/roles: son la misma idea
 * (quien entra y que puede hacer) y separarlas en dos pestañas obligaria a
 * adivinar en cual esta cada cosa.
 */

interface Tab {
  name: string;
  href: string;
  /** Otras rutas que dejan esta pestaña marcada. */
  also?: string[];
}

const TABS: Tab[] = [
  { name: "General", href: "/dashboard/settings" },
  { name: "Equipo y roles", href: "/dashboard/settings/team", also: ["/dashboard/settings/roles"] },
  { name: "Integraciones", href: "/dashboard/settings/integrations" },
  { name: "Tareas", href: "/dashboard/settings/background" },
];

export function SettingsTabs() {
  const pathname = usePathname() ?? "";

  return (
    <nav aria-label="Secciones de ajustes" className="flex flex-wrap gap-1 border-b border-border">
      {TABS.map((tab) => {
        // General es la raiz: solo esta activa con la ruta exacta, si no quedaria
        // marcada en todas.
        const active =
          tab.href === "/dashboard/settings"
            ? pathname === tab.href
            : pathname.startsWith(tab.href) || (tab.also ?? []).some((h) => pathname.startsWith(h));
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.name}
          </Link>
        );
      })}
    </nav>
  );
}
