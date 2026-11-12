/**
 * El checklist de una tarea (Servicios A4, F148 y F153). PURO.
 *
 * Nace de los puntos del paso del camino (`ref.checklist`, que copia `svc_ensure_task`) y en la tarea se tildan uno a
 * uno y se pueden sumar puntos a mano, hasta 30. NO impide completar la tarea (para obligar, el paso pide evidencia).
 *   tasks.checklist = [{ id, text, done, done_by?, done_at? }]
 */

export const TASK_CHECKLIST_MAX = 30;
export const CHECKLIST_TEXT_MAX = 200;

export type ChecklistItem = { id: string; text: string; done: boolean; done_by?: string | null; done_at?: string | null };

export function readChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is ChecklistItem => !!x && typeof x === "object" && typeof (x as ChecklistItem).id === "string" && typeof (x as ChecklistItem).text === "string")
    .map((x) => ({ id: x.id, text: x.text, done: x.done === true, done_by: x.done_by ?? null, done_at: x.done_at ?? null }));
}

/** Lo que nace en la tarea a partir de los puntos del paso. */
export function checklistFromTemplate(points: readonly string[], newId: () => string): ChecklistItem[] {
  return points
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, TASK_CHECKLIST_MAX)
    .map((text) => ({ id: newId(), text: text.slice(0, CHECKLIST_TEXT_MAX), done: false }));
}

export function addChecklistItem(list: readonly ChecklistItem[], text: string, newId: () => string): { ok: true; list: ChecklistItem[] } | { ok: false; error: string } {
  const t = text.trim();
  if (!t) return { ok: false, error: "Escribí el punto." };
  if (t.length > CHECKLIST_TEXT_MAX) return { ok: false, error: `Cada punto puede tener hasta ${CHECKLIST_TEXT_MAX} caracteres.` };
  if (list.length >= TASK_CHECKLIST_MAX) return { ok: false, error: `Una tarea tiene hasta ${TASK_CHECKLIST_MAX} puntos.` };
  return { ok: true, list: [...list, { id: newId(), text: t, done: false }] };
}

export function toggleChecklistItem(list: readonly ChecklistItem[], id: string, done: boolean, by: string, at: string): ChecklistItem[] {
  return list.map((x) => (x.id === id ? { ...x, done, done_by: done ? by : null, done_at: done ? at : null } : x));
}

export function removeChecklistItem(list: readonly ChecklistItem[], id: string): ChecklistItem[] {
  return list.filter((x) => x.id !== id);
}

/** «N de M» para la fila de la tabla y la tarjeta del tablero; null sin checklist. */
export function checklistProgress(list: readonly ChecklistItem[]): { done: number; total: number; label: string } | null {
  if (list.length === 0) return null;
  const done = list.filter((x) => x.done).length;
  return { done, total: list.length, label: `${done} de ${list.length}` };
}

/** Tildar todos NO completa la tarea: es solo para mostrar. */
export function checklistCompletesTask(): false {
  return false;
}
