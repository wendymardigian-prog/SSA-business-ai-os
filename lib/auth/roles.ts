/**
 * Roles del workspace — helpers puros.
 *
 * Sin dependencias de Next ni de Supabase, asi que se puede importar tanto
 * desde el servidor como desde un Client Component. Los guards que necesitan
 * la sesion viven en lib/auth/guards.ts, que es solo del servidor.
 */

export type WorkspaceRole = "owner" | "admin" | "member";

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/** Roles que se pueden asignar a otro miembro. A owner no se llega asignandolo. */
export const ASSIGNABLE_ROLES: WorkspaceRole[] = ["admin", "member"];

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function isOwnerRole(role: string | null | undefined): boolean {
  return role === "owner";
}
