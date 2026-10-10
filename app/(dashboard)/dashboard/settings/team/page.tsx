import { requireWorkspaceAdmin } from "@/lib/auth/guards";
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
    return profiles.map((p) => ({
      userId: p.user_id,
      role: p.role,
      roleId: p.role_id,
      joinedAt: p.joined_at,
      email: p.email ?? "Sin email",
      name: memberDisplayName(p.full_name, p.meta_name, p.email),
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
  // Gestionar el equipo es de Owner/Admin.
  const { workspace, user, role, supabase } = await requireWorkspaceAdmin();

  const serviceClient = await createServiceClient();

  // Todo en paralelo: los miembros (con email y nombre, de auth.users), los
  // roles para el selector de F72 y las invitaciones pendientes. Los roles y
  // las invitaciones con el cliente del usuario: sus policies dejan verlos.
  const [memberDetails, { data: workspaceRoles }, { data: pendingInvites }] = await Promise.all([
    loadTeamMembers(serviceClient, workspace.id),
    supabase.from("workspace_roles").select("id, name, system_role").eq("workspace_id", workspace.id).order("name"),
    supabase
      .from("workspace_invites")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <TeamView
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      currentUserId={user.id}
      currentUserRole={role}
      members={memberDetails}
      pendingInvites={pendingInvites ?? []}
      workspaceRoles={(workspaceRoles ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        systemRole: r.system_role,
      }))}
    />
  );
}
