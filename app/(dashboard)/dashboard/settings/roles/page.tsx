import { redirect } from "next/navigation";
import { RolesView } from "@/components/settings/roles/roles-view";
import { listRoles } from "@/lib/actions/roles";
import { sortRoles } from "@/lib/auth/roles-admin";

export const dynamic = "force-dynamic";

/**
 * Ajustes → Roles (F71).
 *
 * `listRoles` ya exige el permiso `roles.manage`: si la persona no lo tiene,
 * la pantalla no tiene nada que mostrar y se va al dashboard.
 */
export default async function RolesPage() {
  const result = await listRoles();
  if (!result.ok) redirect("/dashboard");

  return <RolesView roles={sortRoles(result.data.roles)} />;
}
