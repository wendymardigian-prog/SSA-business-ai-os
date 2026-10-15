/**
 * Reordenar las reglas de un rol sin que dos reglas vivas compartan nunca una posición (Extra I). Puro.
 *
 * La restricción `uq_commission_rules_position` es DIFERIDA, pero eso solo ayuda dentro de UNA transacción, y
 * cada llamada del cliente de Supabase es la suya: una actualización que cae sobre una posición ocupada falla en el
 * momento. Por eso el plan es una lista de movimientos de a una regla en el que CADA movimiento cae en un lugar
 * libre: primero las que pueden ir directo a su lugar final (en cascada) y, si todas las que quedan se bloquean
 * entre sí (un ciclo), una pasa a una posición temporal para romperlo. Aplicado en orden, nunca choca.
 */

export interface PositionedRule {
  id: string;
  position: number;
}

export interface PositionMove {
  id: string;
  to: number;
}

/**
 * Los movimientos que llevan `current` al orden `orderedIds` (posiciones finales 1..N). Las reglas que ya están
 * en su posición final no se tocan. `orderedIds` tiene que ser exactamente el conjunto de `current`.
 */
export function planPositionMoves(current: readonly PositionedRule[], orderedIds: readonly string[]): PositionMove[] {
  const position = new Map(current.map((r) => [r.id, r.position]));
  const target = new Map(orderedIds.map((id, i) => [id, i + 1]));
  const pending = new Map<string, number>();
  for (const [id, to] of target) if (position.get(id) !== to) pending.set(id, to);

  const occupied = new Map<number, string>();
  for (const [id, pos] of position) occupied.set(pos, id);
  let temp = Math.max(0, ...position.values(), orderedIds.length) + 1;

  const moves: PositionMove[] = [];
  const place = (id: string, to: number) => {
    const from = position.get(id);
    if (from !== undefined && occupied.get(from) === id) occupied.delete(from);
    occupied.set(to, id);
    position.set(id, to);
    moves.push({ id, to });
  };

  while (pending.size > 0) {
    let progress = false;
    for (const [id, to] of [...pending]) {
      if (occupied.has(to)) continue;
      place(id, to);
      pending.delete(id);
      progress = true;
    }
    if (!progress) {
      // Todas se bloquean entre sí: una pasa a una posición libre y el ciclo se abre.
      const [id] = pending.keys();
      place(id, temp++);
    }
  }
  return moves;
}

/** ¿`ids` es exactamente el conjunto `expected` (sin repetidos ni faltantes)? */
export function sameIdSet(ids: readonly string[], expected: readonly string[]): boolean {
  if (ids.length !== expected.length) return false;
  const set = new Set(ids);
  if (set.size !== ids.length) return false;
  return expected.every((id) => set.has(id));
}
