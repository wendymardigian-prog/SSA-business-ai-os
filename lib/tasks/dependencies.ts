/**
 * Dependencias entre tareas (Extra A, F5). PURO.
 *
 * Una tarea puede estar bloqueada por varias (`blocked_by`), sin ciclos. `set_task_blockers`
 * (00197) repite estas reglas en la base; este modulo sirve para validar antes y para que la
 * pantalla no ofrezca lo que se va a rechazar.
 */

import { diffDays } from "./dates";
import { TASK_LIMITS, type TaskBlocker } from "./types";

export type BlockerErrorCode =
  | "cycle"
  | "date_before_blocker"
  | "too_many"
  | "duplicate"
  | "self"
  | "missing_task";

/** blocked_by de cada tarea: id -> ids de las que la bloquean. */
export type BlockedByMap = ReadonlyMap<string, readonly string[]>;

/**
 * ¿Dejar `taskId` bloqueada por `newBlockerIds` cierra un ciclo?
 * Ciclo directo (A -> A), indirecto (A -> B -> C -> A) incluido. Un diamante es valido.
 * Los bloqueantes actuales de `taskId` se reemplazan por los nuevos (asi se usa en la RPC).
 */
export function wouldCreateCycle(blockedBy: BlockedByMap, taskId: string, newBlockerIds: readonly string[]): boolean {
  if (newBlockerIds.includes(taskId)) return true;

  const upstream = (id: string): readonly string[] => (id === taskId ? newBlockerIds : (blockedBy.get(id) ?? []));

  // Subiendo por los bloqueantes de cada nuevo bloqueante: si aparece `taskId`, hay ciclo.
  const seen = new Set<string>();
  const stack = [...newBlockerIds];
  while (stack.length) {
    const id = stack.pop() as string;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const parent of upstream(id)) stack.push(parent);
  }
  return false;
}

/**
 * `gap_days` de una dependencia: vencimiento de la bloqueada menos el del bloqueante.
 * Sin alguna de las dos fechas, 0. Una bloqueada no puede vencer ANTES que su bloqueante
 * (el mismo dia si).
 */
export function computeGap(
  blockerDue: string | null | undefined,
  dependentDue: string | null | undefined,
): { ok: true; gap: number } | { ok: false; error: "date_before_blocker" } {
  if (!blockerDue || !dependentDue) return { ok: true, gap: 0 };
  const gap = diffDays(blockerDue, dependentDue);
  if (gap < 0) return { ok: false, error: "date_before_blocker" };
  return { ok: true, gap };
}

export interface BlockerValidationInput {
  taskId: string;
  dependentDue: string | null;
  blockerIds: readonly string[];
  /** Vencimiento de cada tarea (null si no tiene). Un id ausente = la tarea no existe. */
  dueById: ReadonlyMap<string, string | null>;
  blockedBy: BlockedByMap;
}

/** Valida y arma el nuevo `blocked_by` completo, o devuelve el primer error. */
export function buildBlockers(
  input: BlockerValidationInput,
): { ok: true; blockers: TaskBlocker[] } | { ok: false; error: BlockerErrorCode; taskId?: string } {
  const { taskId, blockerIds, dueById, blockedBy, dependentDue } = input;

  if (blockerIds.length > TASK_LIMITS.blockers) return { ok: false, error: "too_many" };
  if (new Set(blockerIds).size !== blockerIds.length) return { ok: false, error: "duplicate" };
  if (blockerIds.includes(taskId)) return { ok: false, error: "self", taskId };
  for (const id of blockerIds) {
    if (!dueById.has(id)) return { ok: false, error: "missing_task", taskId: id };
  }
  if (wouldCreateCycle(blockedBy, taskId, blockerIds)) return { ok: false, error: "cycle" };

  const blockers: TaskBlocker[] = [];
  for (const id of blockerIds) {
    const gap = computeGap(dueById.get(id), dependentDue);
    if (!gap.ok) return { ok: false, error: gap.error, taskId: id };
    blockers.push({ task_id: id, gap_days: gap.gap });
  }
  return { ok: true, blockers };
}

/**
 * Al editar el vencimiento de una tarea bloqueada: recalcula el `gap_days` de cada
 * dependencia, o rechaza si quedaria antes que algun bloqueante.
 */
export function regapForNewDue(
  blockers: readonly TaskBlocker[],
  newDue: string | null,
  dueById: ReadonlyMap<string, string | null>,
): { ok: true; blockers: TaskBlocker[] } | { ok: false; error: "date_before_blocker"; taskId: string } {
  const next: TaskBlocker[] = [];
  for (const b of blockers) {
    const gap = computeGap(dueById.get(b.task_id), newDue);
    if (!gap.ok) return { ok: false, error: gap.error, taskId: b.task_id };
    next.push({ task_id: b.task_id, gap_days: newDue ? gap.gap : b.gap_days });
  }
  return { ok: true, blockers: next };
}

/** Mensajes en castellano para mostrar tal cual. */
export const BLOCKER_ERROR_MESSAGES: Record<BlockerErrorCode, string> = {
  cycle: "Eso crearía un ciclo: una tarea no puede depender, directa o indirectamente, de sí misma.",
  date_before_blocker: "Una tarea no puede vencer antes que la que la bloquea.",
  too_many: `Una tarea puede tener como máximo ${TASK_LIMITS.blockers} bloqueantes.`,
  duplicate: "Ese bloqueante ya está agregado.",
  self: "Una tarea no puede bloquearse a sí misma.",
  missing_task: "No encontramos una de las tareas bloqueantes.",
};
