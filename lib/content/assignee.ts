/**
 * El responsable de una pieza.
 *
 * Cada pieza guarda DOS personas distintas: quien la creo (`created_by`, no
 * cambia nunca) y su responsable (`assigned_to`, se puede cambiar; por defecto
 * es quien la crea). Para lo que la base deja editar a un Member, las dos
 * valen: la politica de `content_posts` (00223) acepta cualquiera de las dos.
 *
 * Puro: sin React ni base.
 */

export interface PieceOwners {
  created_by: string | null;
  assigned_to: string | null;
}

/** Si esta persona es quien la creo o su responsable: lo que un Member necesita para editarla. */
export function isAuthorOrAssignee(userId: string, piece: PieceOwners): boolean {
  return piece.created_by === userId || piece.assigned_to === userId;
}

/**
 * Si puede CAMBIAR el responsable: un administrador o quien la creo. Quien solo
 * es responsable edita la pieza pero no la pasa a otra persona (la politica de
 * la base lo rechazaria: la fila ya no seria suya).
 */
export function canReassign(params: { role: string; userId: string; piece: PieceOwners }): boolean {
  if (params.role === "owner" || params.role === "admin") return true;
  return params.piece.created_by === params.userId;
}

export interface AssigneeInfo {
  id: string;
  name: string;
}

/** La persona del tablero a partir del id y los nombres del equipo. Sin nombre conocido, no se inventa uno. */
export function assigneeOf(id: string | null | undefined, names: ReadonlyMap<string, string>): AssigneeInfo | null {
  if (!id) return null;
  const name = names.get(id);
  return name ? { id, name } : null;
}
