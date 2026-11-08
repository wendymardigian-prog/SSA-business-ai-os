/**
 * Quiénes del negocio tienen una clave de permiso (Diseñador IA). Lo usa el aviso de «falta un dato» (F55) para que le
 * llegue a cada persona que puede generar, también a un rol personalizado que no es Owner ni Admin (un aviso sin
 * destinatario lo ven solo Owner y Admin: `can_see_notification`).
 *
 * Los permisos de Owner y Admin salen de la tabla de TypeScript (la fuente); un `member` con rol personalizado, de su
 * fila. Necesita el cliente de servicio. Nunca lanza: si no se puede saber, devuelve una lista vacía y quien llama usa el
 * aviso para Owner y Admin.
 *
 * Es una copia chica de lo que hace Llamadas para sus avisos: el Diseñador no puede importar de un módulo que una
 * plantilla puede quitar (`scripts/plantilla/modulos.test.ts`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { can, parsePermissions, systemRolePermissions } from "@/lib/auth/permissions";
import type { Database } from "@/lib/types/database";

export async function membersWithPermission(db: SupabaseClient<Database>, workspaceId: string, key: string): Promise<string[]> {
  try {
    const [{ data: members }, { data: roles }] = await Promise.all([
      db.from("workspace_members").select("user_id, role, role_id").eq("workspace_id", workspaceId),
      db.from("workspace_roles").select("id, system_role, permissions").eq("workspace_id", workspaceId),
    ]);
    const rolesById = new Map((roles ?? []).map((r) => [r.id, r]));
    return (members ?? [])
      .filter((m) => {
        let permissions = systemRolePermissions(m.role);
        if (m.role === "member" && m.role_id) {
          const row = rolesById.get(m.role_id);
          if (row && !row.system_role) permissions = parsePermissions(row.permissions);
        }
        return can(permissions ?? systemRolePermissions("member"), key);
      })
      .map((m) => m.user_id);
  } catch (error) {
    console.error("[designer] no pude resolver quién tiene el permiso:", error instanceof Error ? error.message : "error");
    return [];
  }
}
