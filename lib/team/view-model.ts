/**
 * Qué controles ve cada persona en Equipo (Equipo y roles, F6). Puro: la pantalla lo compone.
 *
 * - `team.view`   la lista (sin controles).
 * - `team.manage` el selector de rol y la marca de Closer de cada persona.
 * - `team.remove` quitar a alguien (solo el Owner la tiene).
 * - `team.invite` el formulario de invitar y las acciones de pendientes.
 */

export interface TeamViewer {
  userId: string;
  can: (key: string) => boolean;
}

export interface TeamMemberRef {
  userId: string;
  role: string;
}

export interface MemberRowControls {
  /** El selector para cambiarle el rol. */
  roleSelect: boolean;
  /** La marca de Closer y sus correos. */
  closer: boolean;
  /** El botón de quitar de la fila. */
  remove: boolean;
  /** La insignia de solo lectura con el nombre del rol (cuando no hay selector). */
  roleBadge: boolean;
}

export function memberRowControls(viewer: TeamViewer, member: TeamMemberRef): MemberRowControls {
  const isSelf = viewer.userId === member.userId;
  const isOwner = member.role === "owner";
  const roleSelect = viewer.can("team.manage") && !isOwner && !isSelf;
  return {
    roleSelect,
    closer: viewer.can("team.manage"),
    remove: viewer.can("team.remove") && !isSelf,
    roleBadge: !roleSelect,
  };
}

export interface TeamSections {
  members: boolean;
  invite: boolean;
  pending: boolean;
  history: boolean;
}

/** Qué bloques de la página ve quien la abre (la página en sí exige `team.view`). */
export function teamSections(viewer: Pick<TeamViewer, "can">): TeamSections {
  const invite = viewer.can("team.invite");
  return { members: viewer.can("team.view"), invite, pending: invite, history: invite };
}
