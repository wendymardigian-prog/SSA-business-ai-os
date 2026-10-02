"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Segmented control Miembros | Roles (S3).
 *
 * Antes no había forma de pasar de Equipo a Roles ni al revés: Roles era
 * una ruta propia cuya única puerta era una tarjeta enterrada en una
 * sección de General (eliminada en S2). Se muestra debajo de las pestañas
 * de Ajustes, en las dos pantallas.
 *
 * `canSeeMembers` oculta "Miembros" para quien llega a Roles con un rol
 * personalizado con `roles.manage` pero sin ser Owner/Admin: la pantalla
 * de Equipo usa `requireWorkspaceAdmin` y lo rebotaría. Sin un segundo
 * destino, el control no suma nada y no se muestra.
 */
export function TeamRolesSwitch({ canSeeMembers = true }: { canSeeMembers?: boolean }) {
  const pathname = usePathname() ?? "";
  const onRoles = pathname.startsWith("/dashboard/settings/roles");

  const items = [
    ...(canSeeMembers
      ? [{ label: "Miembros", href: "/dashboard/settings/team", active: !onRoles }]
      : []),
    { label: "Roles", href: "/dashboard/settings/roles", active: onRoles },
  ];

  if (items.length < 2) return null;

  return (
    <div className="border-b border-border px-4 pt-3 pb-3 sm:px-8">
      <div className="inline-flex gap-1 rounded-lg border border-border p-0.5">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              item.active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
