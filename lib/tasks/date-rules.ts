/**
 * Regla de fechas de las dependencias (Extra A, F3). PURA.
 *
 * Al completar un bloqueante, cada tarea que depende de el no puede vencer antes de
 * `basis + gap_days`, donde `basis` es la fecha REAL de completado del bloqueante (si ya
 * esta completado) o, si no, su vencimiento. Con varios bloqueantes manda el mayor.
 *
 * Reglas que no se discuten:
 *  - SOLO ATRASA, nunca adelanta.
 *  - Solo participan dependientes abiertos y con vencimiento.
 *  - Un bloqueante sin fecha y sin completar se ignora.
 *  - Propaga por la cadena (A -> B -> C) en orden topologico.
 *  - Dias corridos. `start_date`, si existe, se corre los mismos dias (conserva la duracion).
 *  - No lee el reloj ni muta lo que recibe: la RPC `complete_task_with_shifts` solo APLICA este plan.
 */

import { addDays, diffDays } from "./dates";
import type { TaskBlocker, TaskStatus } from "./types";

export interface DateRuleTask {
  id: string;
  status: TaskStatus;
  due_date: string | null;
  start_date: string | null;
  /** AAAA-MM-DD en que se completo (si ya lo esta). */
  completed_on?: string | null;
  blocked_by: TaskBlocker[];
}

export interface DateShift {
  taskId: string;
  fromDue: string;
  toDue: string;
  fromStart: string | null;
  toStart: string | null;
  /** Cuantos dias se corre. Siempre > 0. */
  days: number;
  /** El bloqueante que fijo la nueva fecha. */
  blockerId: string;
}

export interface DateShiftPlan {
  /** En orden topologico: primero los mas cercanos a la tarea completada. */
  shifts: DateShift[];
}

export interface ComputeDateShiftsArgs {
  tasks: readonly DateRuleTask[];
  completedTaskId: string;
  /** AAAA-MM-DD en que se completa (hoy en la zona del workspace). */
  completedOn: string;
}

export function computeDateShifts({ tasks, completedTaskId, completedOn }: ComputeDateShiftsArgs): DateShiftPlan {
  const byId = new Map<string, DateRuleTask>();
  for (const t of tasks) byId.set(t.id, t);
  if (!byId.has(completedTaskId)) return { shifts: [] };

  // dependientes[x] = tareas que x bloquea.
  const dependents = new Map<string, string[]>();
  for (const t of tasks) {
    for (const b of t.blocked_by ?? []) {
      const list = dependents.get(b.task_id) ?? [];
      list.push(t.id);
      dependents.set(b.task_id, list);
    }
  }

  // Todo lo alcanzable desde la tarea completada.
  const reachable = new Set<string>();
  const stack = [...(dependents.get(completedTaskId) ?? [])];
  while (stack.length) {
    const id = stack.pop() as string;
    if (reachable.has(id) || id === completedTaskId) continue;
    reachable.add(id);
    for (const next of dependents.get(id) ?? []) stack.push(next);
  }
  if (reachable.size === 0) return { shifts: [] };

  // Orden topologico (Kahn) restringido a lo alcanzable. Un ciclo en los datos deja nodos afuera.
  const indegree = new Map<string, number>();
  for (const id of reachable) {
    const t = byId.get(id) as DateRuleTask;
    indegree.set(id, (t.blocked_by ?? []).filter((b) => reachable.has(b.task_id)).length);
  }
  const queue: string[] = [];
  for (const [id, n] of indegree) if (n === 0) queue.push(id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift() as string;
    order.push(id);
    for (const next of dependents.get(id) ?? []) {
      if (!reachable.has(next)) continue;
      const n = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, n);
      if (n === 0) queue.push(next);
    }
  }

  // Vencimientos vigentes mientras se arma el plan (los corridos pisan a los originales).
  const effectiveDue = new Map<string, string | null>();
  for (const t of tasks) effectiveDue.set(t.id, t.due_date);

  const basisOf = (blockerId: string): string | null => {
    if (blockerId === completedTaskId) return completedOn;
    const b = byId.get(blockerId);
    if (!b) return null;
    if (b.status === "completed") return b.completed_on ?? b.due_date ?? null;
    return effectiveDue.get(blockerId) ?? null;
  };

  const shifts: DateShift[] = [];
  for (const id of order) {
    const t = byId.get(id) as DateRuleTask;
    if (t.status === "completed" || !t.due_date) continue;

    let minDate: string | null = null;
    let decidedBy = "";
    for (const blocker of t.blocked_by ?? []) {
      const basis = basisOf(blocker.task_id);
      if (!basis) continue;
      const candidate = addDays(basis, blocker.gap_days);
      if (minDate === null || candidate > minDate) {
        minDate = candidate;
        decidedBy = blocker.task_id;
      }
    }
    if (minDate === null || minDate <= t.due_date) continue;

    const days = diffDays(t.due_date, minDate);
    effectiveDue.set(id, minDate);
    shifts.push({
      taskId: id,
      fromDue: t.due_date,
      toDue: minDate,
      fromStart: t.start_date,
      toStart: t.start_date ? addDays(t.start_date, days) : null,
      days,
      blockerId: decidedBy,
    });
  }

  return { shifts };
}
