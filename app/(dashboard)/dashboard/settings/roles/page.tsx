import { redirect } from "next/navigation";
import { RolesView } from "@/components/settings/roles/roles-view";
import { listRoles } from "@/lib/actions/roles";
import { sortRoles } from "@/lib/auth/roles-admin";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * Ajustes → Roles (F71).
 *
 * `listRoles` ya exige el permiso `roles.manage`: si la persona no lo tiene,
 * la pantalla no tiene nada que mostrar y se va al dashboard. El guard no
 * cambia (S6): esto no es un segundo guard, es solo lectura para saber si
 * mostrar "Miembros" en el segmented (S3) — un rol personalizado con
 * `roles.manage` que no es Owner/Admin entra acá pero /settings/team lo
 * rebotaría.
 */
export default async function RolesPage() {
  const result = await listRoles();
  if (!result.ok) redirect("/dashboard");

  const { role } = await getWorkspace();

  return <RolesView roles={sortRoles(result.data.roles)} canSeeMembers={isAdminRole(role)} />;
}
