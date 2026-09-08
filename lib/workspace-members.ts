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
          name:
            (user?.user_metadata?.full_name as string | undefined) ??
            (user?.user_metadata?.name as string | undefined) ??
            user?.email?.split("@")[0] ??
            "Sin nombre",
        };
      }),
    );

    return details.sort((a, b) => a.name.localeCompare(b.name, "es"));
  },
);

/** Mapa id -> nombre, que es como lo consumen las pantallas. */
export function memberLabels(members: WorkspaceMemberInfo[]): Map<string, string> {
  return new Map(members.map((m) => [m.userId, m.name]));
}
