/**
 * De un movimiento del tablero a los cambios que hay que guardar (Extra A, F16). PURO.
 * La tarjeta movida guarda su estado (si cambio de columna) y su posicion; si hubo que renumerar la columna, el resto
 * solo guarda su posicion.
 */

import type { CellPatch } from "./cell-edit";
import type { MovePlan } from "./kanban-model";

export interface BoardEdit {
  id: string;
  patch: CellPatch;
}

export function planMoveToEdits(taskId: string, plan: MovePlan): BoardEdit[] {
  return plan.updates.map((u) => ({
    id: u.id,
    patch: u.id === taskId && plan.changesStatus ? { status: plan.status, position: u.position } : { position: u.position },
  }));
}
