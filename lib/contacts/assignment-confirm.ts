/**
 * ¿Hay que avisar antes de sacarse a uno mismo de un lead? Con el alcance de leads prendido, un Member que
 * se saca del setter o del vendedor puede dejar de ver el contacto (RLS). Pura: la usan `AssignmentFields`
 * y el selector de «Estado del lead».
 *
 * No hace falta avisar si es admin, si el cambio no lo saca a el, si no era quien estaba asignado en ese
 * rol, o si sigue figurando en el OTRO rol (entonces el contacto sigue siendo suyo).
 */
export function needsSelfRemovalConfirm(input: {
  isAdmin: boolean;
  currentUserId: string;
  /** Quien queda en el rol que se cambia. */
  next: string | null;
  /** Quien estaba en el rol que se cambia. */
  current: string | null;
  /** Quien esta en el OTRO rol. */
  other: string | null;
}): boolean {
  if (input.isAdmin) return false;
  if (input.next === input.currentUserId) return false;
  if (input.current !== input.currentUserId) return false;
  return input.other !== input.currentUserId;
}

export const SELF_REMOVAL_MESSAGE = "Si te sacás de este lead vas a dejar de verlo. ¿Seguro?";
