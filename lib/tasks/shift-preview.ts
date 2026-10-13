/**
 * La vista previa de fechas al completar una tarea (Extra A, F13). PURO.
 * El dialogo solo dibuja lo que esto arma.
 */

import { formatDay, pluralDays } from "./format";

export interface ShiftLineInput {
  title: string;
  fromDue: string;
  toDue: string;
  days: number;
}

/** «Preparar contrato — 11/10/2026 → 14/10/2026 (+3 días)» */
export function formatShiftLine(shift: ShiftLineInput): string {
  return `${shift.title} — ${formatDay(shift.fromDue)} → ${formatDay(shift.toDue)} (+${pluralDays(shift.days)})`;
}

export interface ChainShift extends ShiftLineInput {
  taskId: string;
  blockerId: string;
  blockerTitle: string;
}

export interface ShiftChain {
  /** La tarea que dispara la cadena (la que se esta completando o un bloqueante que no se mueve). */
  startTitle: string;
  shifts: ChainShift[];
}

/**
 * Agrupa los corrimientos por cadena: cada grupo arranca en una tarea que se mueve por culpa de algo que
 * NO se mueve (la tarea completada u otro bloqueante), y lo que cuelga de ella queda adentro, en orden.
 */
export function groupShiftsByChain(shifts: readonly ChainShift[]): ShiftChain[] {
  const moved = new Set(shifts.map((s) => s.taskId));
  const rootOf = new Map<string, string>();
  for (const s of shifts) {
    // Sube por `blockerId` mientras el bloqueante tambien se mueva.
    let current = s;
    const seen = new Set<string>();
    while (moved.has(current.blockerId) && !seen.has(current.taskId)) {
      seen.add(current.taskId);
      current = shifts.find((x) => x.taskId === current.blockerId) as ChainShift;
    }
    rootOf.set(s.taskId, current.taskId);
  }

  const chains = new Map<string, ShiftChain>();
  for (const s of shifts) {
    const root = rootOf.get(s.taskId) as string;
    const rootShift = shifts.find((x) => x.taskId === root) as ChainShift;
    const chain = chains.get(root) ?? { startTitle: rootShift.blockerTitle, shifts: [] };
    chain.shifts.push(s);
    chains.set(root, chain);
  }
  return [...chains.values()];
}

/** El resumen de una linea para el titulo del dialogo. */
export function shiftSummary(count: number): string {
  return count === 1 ? "Esto mueve la fecha de 1 tarea" : `Esto mueve las fechas de ${count} tareas`;
}

/** Con plan vacio se completa directo; con plan, se pregunta. */
export function completionRoute(shiftCount: number): "direct" | "dialog" {
  return shiftCount === 0 ? "direct" : "dialog";
}
