import { redirect } from "next/navigation";
import { RolesView } from "@/components/settings/roles/roles-view";
import { listRoles } from "@/lib/actions/roles";
import { sortRoles } from "@/lib/auth/roles-admin";
import { getPermissionContext } from "@/lib/auth/guards";
import { grantActorOf } from "@/lib/team/grant";
import { accountLabel } from "@/lib/inbox/accounts";
import { platformLabel } from "@/lib/platforms";

export const dynamic = "force-dynamic";

/**
 * Ajustes → Roles (F71, B3).
 *
 * `listRoles` pide `roles.view` o `roles.manage`: sin ninguna de las dos no hay nada que mostrar y
 * se va al dashboard. Con solo `roles.view` la pantalla es de lectura; editar, crear y borrar piden
 * `roles.manage` (lo repiten las acciones y la base). «Miembros» del segmented se oculta si esa
 * pantalla rebotaría a quien mira (`team.view`).
 */
export default async function RolesPage() {
  const result = await listRoles();
  if (!result.ok) redirect("/dashboard");

  const ctx = await getPermissionContext();

  // Las cuentas conectadas (tambien las desconectadas: un rol puede seguir teniendolas), para dar la bandeja
  // cuenta por cuenta (00249).
  const { data: channelRows } = await ctx.supabase
    .from("channels")
    .select("id, platform, username, display_name, is_active")
    .eq("workspace_id", ctx.workspace.id);
  const accounts = (channelRows ?? [])
    .map((c) => ({ id: c.id, platform: c.platform, label: accountLabel(c), active: c.is_active }))
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        platformLabel(a.platform).localeCompare(platformLabel(b.platform), "es") ||
        a.label.localeCompare(b.label, "es", { sensitivity: "base" }),
    );

  return (
    <RolesView
      roles={sortRoles(result.data.roles)}
      canManage={result.data.canManage}
      canSeeMembers={ctx.can("team.view")}
      viewer={grantActorOf(ctx)}
      accounts={accounts}
    />
  );
}
