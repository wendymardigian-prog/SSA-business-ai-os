"use client";

import { usePathname } from "next/navigation";
import { HeaderTabs } from "@/components/ui/header-tabs";

/**
 * Segmented control Miembros | Roles (S3).
 *
 * Antes no había forma de pasar de Equipo a Roles ni al revés: Roles era
 * una ruta propia cuya única puerta era una tarjeta enterrada en una
 * sección de General (eliminada en S2). Va en la barra superior de las dos
 * pantallas (`<PageHeader filters={<TeamRolesSwitch />} />`), con el mismo
 * control de pestañas que el resto (`HeaderTabs`).
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
    ...(canSeeMembers ? [{ key: "members", label: "Miembros", href: "/dashboard/settings/team" }] : []),
    { key: "roles", label: "Roles", href: "/dashboard/settings/roles" },
  ];

  if (items.length < 2) return null;

  return <HeaderTabs label="Miembros o roles" items={items} active={onRoles ? "roles" : "members"} />;
}
