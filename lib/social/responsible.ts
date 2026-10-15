/**
 * Quien es el responsable de una publicacion (Extra I, F43).
 *
 * - Una publicacion CON pieza muestra el responsable de la pieza, solo lectura, con link a la pieza.
 * - Una publicacion SIN pieza (externa o marcada a mano) tiene su propio responsable (`social_posts.assigned_to`)
 *   y quien puede publicar lo cambia con un selector.
 *
 * PURO: sin base ni React. La accion que lee los datos arma las entradas; la pantalla solo dibuja el resultado.
 */

export interface TeamMember {
  id: string;
  name: string;
}

export type PostResponsible =
  | {
      mode: "piece";
      pieceId: string;
      pieceTitle: string | null;
      /** Null si la pieza no tiene responsable o ya no se conoce a la persona. */
      assignee: TeamMember | null;
    }
  | {
      mode: "post";
      assignee: TeamMember | null;
      /** Quien puede cambiarlo. Si es false, `team` va vacio: no se reparte el equipo a quien no lo va a usar. */
      canAssign: boolean;
      team: TeamMember[];
    };

export interface ResponsibleInput {
  contentPostId: string | null;
  postAssignedTo: string | null;
  piece: { title: string | null; assignedTo: string | null } | null;
  members: readonly { userId: string; name: string }[];
  canAssign: boolean;
}

/** La persona con su nombre, o null si no hay id o no se la conoce (no se inventa un nombre). */
function personOf(id: string | null | undefined, members: ResponsibleInput["members"]): TeamMember | null {
  if (!id) return null;
  const member = members.find((m) => m.userId === id);
  return member ? { id, name: member.name } : null;
}

export function buildResponsible(input: ResponsibleInput): PostResponsible {
  if (input.contentPostId) {
    return {
      mode: "piece",
      pieceId: input.contentPostId,
      pieceTitle: input.piece?.title ?? null,
      assignee: personOf(input.piece?.assignedTo, input.members),
    };
  }
  return {
    mode: "post",
    assignee: personOf(input.postAssignedTo, input.members),
    canAssign: input.canAssign,
    team: input.canAssign ? input.members.map((m) => ({ id: m.userId, name: m.name })) : [],
  };
}
