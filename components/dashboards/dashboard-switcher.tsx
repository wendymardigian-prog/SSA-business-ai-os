"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * El selector de dashboards, en la barra superior (F48).
 *
 * Reemplaza la pastilla fija "Chat" que estaba al lado del titulo. El
 * dashboard de Chat NO cambia: misma ruta, mismos datos. Lo unico que cambia
 * es que ahora se puede ir a otro lado desde ahi.
 *
 * Es un grupo de links y no un `select`: son tres destinos, se ve cual esta
 * activo, y un link se puede abrir en otra pestaña.
 */

export const DASHBOARDS = [
  { key: "chat", label: "Chat", href: "/dashboard/dashboards/chat" },
  { key: "content", label: "Contenido organico", href: "/dashboard/dashboards/content" },
  { key: "ads", label: "Anuncios", href: "/dashboard/dashboards/ads" },
] as const;

export function DashboardSwitcher({
  /** Cuales estan disponibles. Anuncios recien con Meta conectado. */
  available = ["chat", "content"],
}: {
  available?: string[];
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboards" className="ml-2 flex items-center gap-1 overflow-x-auto">
      {DASHBOARDS.filter((d) => available.includes(d.key)).map((dashboard) => {
        const active = pathname?.startsWith(dashboard.href);
        return (
          <Link
            key={dashboard.key}
            href={dashboard.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium"
                : "shrink-0 rounded-full px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent/50"
            }
          >
            {dashboard.label}
          </Link>
        );
      })}
    </nav>
  );
}
