/**
 * El reparto por turnos (plano F14), portado de `apply-contact-setter-assignment`
 * de prevxcrm. El puntero es el ÍNDICE del último asignado dentro de la lista de
 * `members` (no un contador módulo la lista de activos, que se corría cuando
 * alguien se desactivaba: el bug del original).
 *
 * `pickRoundRobin(members, lastIndex, activeMembers)`: el siguiente de la lista
 * después de `lastIndex` que esté activo, dando la vuelta. `nextIndex` es el
 * índice del elegido (el nuevo "último"). Lista vacía o nadie activo → null.
 */
export function pickRoundRobin(
  members: readonly string[],
  lastIndex: number | null | undefined,
  activeMembers: ReadonlySet<string> | readonly string[],
): { memberId: string; nextIndex: number } | null {
  if (members.length === 0) return null;
  const active = activeMembers instanceof Set ? activeMembers : new Set(activeMembers as readonly string[]);
  const start = typeof lastIndex === "number" && Number.isInteger(lastIndex) ? lastIndex : -1;

  for (let step = 1; step <= members.length; step++) {
    const index = (((start + step) % members.length) + members.length) % members.length;
    const candidate = members[index];
    if (active.has(candidate)) return { memberId: candidate, nextIndex: index };
  }
  return null;
}

/** El índice del último asignado (-1 si nunca se asignó o ya no está en la lista). */
export function lastIndexOf(members: readonly string[], lastAssignedId: string | null | undefined): number {
  if (!lastAssignedId) return -1;
  return members.indexOf(lastAssignedId);
}
