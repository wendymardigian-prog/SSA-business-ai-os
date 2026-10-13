/**
 * «Mis tareas» (Extra A, F19): los contadores de la cabecera. PURO.
 * «Mis tareas» = responsable yo y sin completar; los contadores miran solo esas, con vencimiento.
 */

import { addDays } from "./dates";
import type { TaskRow } from "./types";

export interface MineSummary {
  /** Vencidas: vencieron antes de hoy. */
  overdue: number;
  /** Vencen hoy. */
  today: number;
  /** Vencen en los proximos 7 dias (manana a hoy + 7). */
  next7: number;
  /** Todas las abiertas a mi cargo (con o sin fecha). */
  open: number;
}

export function summarizeMine(
  tasks: readonly Pick<TaskRow, "owner_id" | "status" | "due_date">[],
  todayLocal: string,
  meId: string,
): MineSummary {
  const limit = addDays(todayLocal, 7);
  const summary: MineSummary = { overdue: 0, today: 0, next7: 0, open: 0 };
  for (const t of tasks) {
    if (t.owner_id !== meId || t.status === "completed") continue;
    summary.open += 1;
    if (!t.due_date) continue;
    if (t.due_date < todayLocal) summary.overdue += 1;
    else if (t.due_date === todayLocal) summary.today += 1;
    else if (t.due_date <= limit) summary.next7 += 1;
  }
  return summary;
}
