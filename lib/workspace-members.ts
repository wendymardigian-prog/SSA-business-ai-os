import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Nombres de los miembros del workspace, para los desplegables de setter y
 * vendedor y para firmar las notas y el historial.
 *
 * Necesita la service key: los nombres y emails viven en auth.users, que no es
 * accesible por RLS desde el cliente. Es el mismo camino que ya usa la
 * pantalla de equipo. Lo unico que sale de aca es id, nombre y email de gente
 * del mismo workspace — nada que esos miembros no puedan ver igual en /settings/team.
 *
 * Una sola consulta a la base (`workspace_member_profiles`, 00141): antes era
 * una llamada a la API de Auth por miembro, en cada render.
 *
 * Envuelto en cache() de React: la ficha lo pide para el desplegable, para las
 * notas y para el historial, y con esto se resuelve una sola vez por request.
 */

export interface WorkspaceMemberInfo {
  userId: string;
  role: string;
  name: string;
  email: string;
}

export const getWorkspaceMembers = cache(
  async (workspaceId: string): Promise<WorkspaceMemberInfo[]> => {
    const service = await createServiceClient();

    // Una sola consulta (00141). Si la funcion todavia no esta en esta base,
    // el camino viejo: uno por uno contra la API de Auth.
    const { data: profiles, error: rpcError } = await service.rpc("workspace_member_profiles", {
      p_workspace_id: workspaceId,
    });
    if (!rpcError && profiles) {
      return profiles
        .map((p) => ({
          userId: p.user_id,
          role: p.role,
          email: p.email ?? "",
          name: memberDisplayName(p.full_name, p.meta_name, p.email),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
    }
    console.warn("[workspace-members] sin workspace_member_profiles, uso el camino lento:", rpcError?.message);

    const { data: members, error } = await service
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspaceId);

    if (error) {
      console.error("[workspace-members] no pude listar los miembros:", error.message);
      return [];
    }

    const details = await Promise.all(
      (members ?? []).map(async (member) => {
        const { data } = await service.auth.admin.getUserById(member.user_id);
        const user = data?.user;
        return {
          userId: member.user_id,
          role: member.role,
          email: user?.email ?? "",
          name: memberDisplayName(
            user?.user_metadata?.full_name as string | undefined,
            user?.user_metadata?.name as string | undefined,
            user?.email,
          ),
        };
      }),
    );

    return details.sort((a, b) => a.name.localeCompare(b.name, "es"));
  },
);

/** El nombre que se muestra: el completo, el corto, la parte del email, o "Sin nombre". */
export function memberDisplayName(
  fullName: string | null | undefined,
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  return fullName || name || email?.split("@")[0] || "Sin nombre";
}

/** Mapa id -> nombre, que es como lo consumen las pantallas. */
export function memberLabels(members: WorkspaceMemberInfo[]): Map<string, string> {
  return new Map(members.map((m) => [m.userId, m.name]));
}
