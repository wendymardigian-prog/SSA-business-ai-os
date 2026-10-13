/**
 * ¿A esta persona le toca completar este reporte? Puro.
 */
import type { EodConfig } from "./config";

export interface AudienceMember {
  userId: string;
  /** El rol del workspace (`workspace_roles.id`). Null si no tiene. */
  roleId: string | null;
  /** `false` si salió del workspace: nunca está en la audiencia. */
  isMember: boolean;
}

export function isInAudience(config: Pick<EodConfig, "audience">, member: AudienceMember): boolean {
  if (!member.isMember) return false;
  const { audience } = config;
  switch (audience.mode) {
    case "all":
      return true;
    case "users":
      return audience.userIds.includes(member.userId);
    case "roles":
      return member.roleId !== null && audience.roleIds.includes(member.roleId);
  }
}
