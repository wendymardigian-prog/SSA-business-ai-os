import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/auth/guards";
import { parsePermissions, systemRolePermissions } from "@/lib/auth/permissions";
import { assertCanAssignRole, grantActorOf, type RoleToGive } from "@/lib/team/grant";
import { isEmailConfigured } from "@/lib/email/send";
import { TeamView } from "@/components/settings/team-view";
import { createServiceClient } from "@/lib/supabase/server";
import { memberDisplayName } from "@/lib/workspace-members";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

/**
 * Los miembros con email y nombre. Una sola consulta (00141); si la funcion
 * todavia no esta en esta base, el camino viejo: uno por uno contra Auth.
 * Service client: auth.users no se lee por RLS, y la policy de SELECT de
 * workspace_members solo devuelve la fila propia.
 */
async function loadTeamMembers(service: ServiceClient, workspaceId: string) {
  const { data: profiles, error } = await service.rpc("workspace_member_profiles", { p_workspace_id: workspaceId });
  if (!error && profiles) {
    // @plantilla-desde(llamadas)
    // Quien graba llamadas (Llamadas, 00145): una consulta chica aparte.
    const { data: closers } = await service
      .from("workspace_members")
      .select("user_id, is_closer, closer_emails")
      .eq("workspace_id", workspaceId);
    const closerOf = new Map((closers ?? []).map((c) => [c.user_id, c]));
    // @plantilla-hasta(llamadas)
    return profiles.map((p) => ({
      userId: p.user_id,
      role: p.role,
      roleId: p.role_id,
      joinedAt: p.joined_at,
      email: p.email ?? "Sin email",
      name: memberDisplayName(p.full_name, p.meta_name, p.email),
      isCloser: closerOf.get(p.user_id)?.is_closer ?? false, // @plantilla-quitar(llamadas)
      closerEmails: closerOf.get(p.user_id)?.closer_emails ?? [], // @plantilla-quitar(llamadas)
    }));
  }

  const { data: members } = await service
    .from("workspace_members")
    .select("workspace_id, user_id, role, role_id, created_at")
    .eq("workspace_id", workspaceId);

  return Promise.all(
    (members ?? []).map(async (member) => {
      const {
        data: { user: memberUser },
      } = await service.auth.admin.getUserById(member.user_id);

      return {
        userId: member.user_id,
        role: member.role,
        roleId: member.role_id,
        joinedAt: member.created_at,
        email: memberUser?.email ?? "Sin email",
        name: memberDisplayName(
          memberUser?.user_metadata?.full_name as string | undefined,
          memberUser?.user_metadata?.name as string | undefined,
          memberUser?.email,
        ),
      };
    }),
  );
}

export default async function TeamPage() {
  // Ver el equipo exige `team.view`; los controles de cada bloque piden su propia clave (lib/team/view-model.ts).
  const ctx = await requirePermission("team.view");
  const { workspace, user, supabase } = ctx;
  const canInvite = ctx.can("team.invite");

  const serviceClient = await createServiceClient();

  // Todo en paralelo: los miembros (con email y nombre, de auth.users), los roles para el selector, y,
  // para quien invita, las invitaciones y si el email esta conectado.
  const [memberDetails, { data: workspaceRoles }, invitesRes, emailConfigured] = await Promise.all([
    loadTeamMembers(serviceClient, workspace.id),
    supabase.from("workspace_roles").select("id, name, system_role, permissions").eq("workspace_id", workspace.id).order("name"),
    canInvite
      ? supabase
          .from("workspace_invites")
          .select("id, email, role, role_id, invited_by, status, created_at, expires_at, delivery, email_status, last_sent_at, send_count, accepted_at, accepted_by, revoked_at, revoked_by")
          .eq("workspace_id", workspace.id)
          .order("created_at", { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [] as never[] }),
    canInvite ? isEmailConfigured(serviceClient as unknown as SupabaseClient, workspace.id) : Promise.resolve(false),
  ]);

  // Los roles que quien mira puede dar: la misma regla que aplica el servidor al invitar y asignar.
  const actor = grantActorOf(ctx);
  const roleOptions = (workspaceRoles ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    systemRole: r.system_role as "owner" | "admin" | "member" | null,
  }));
  const grantableRoleIds = (workspaceRoles ?? [])
    .filter((r) => r.system_role !== "owner")
    .filter((r) =>
      assertCanAssignRole(
        actor,
        {
          id: r.id,
          systemRole: r.system_role as RoleToGive["systemRole"],
          permissions: r.system_role ? (systemRolePermissions(r.system_role) ?? parsePermissions(null)) : parsePermissions(r.permissions),
        },
        null,
      ).ok,
    )
    .map((r) => r.id);

  return (
    <TeamView
      workspaceId={workspace.id}
      currentUserId={user.id}
      viewerKeys={ctx.permissions.keys}
      members={memberDetails}
      invites={invitesRes.data ?? []}
      workspaceRoles={roleOptions}
      grantableRoleIds={grantableRoleIds}
      emailConfigured={emailConfigured}
      personNames={Object.fromEntries(memberDetails.map((m) => [m.userId, m.name]))}
    />
  );
}
