/**
 * «Mis tareas» (Extra A, F19): los contadores de la cabecera. PURO.
 * «Mis tareas» = responsable yo y sin completar; los contadores miran solo esas, con vencimiento.
 */

import { addDays } from "./dates";
import { dueSeen, type DueZones } from "./due-view";
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
  tasks: readonly (Pick<TaskRow, "owner_id" | "status" | "due_date"> & { due_time?: string | null })[],
  /** El dia de quien mira. */
  todayLocal: string,
  meId: string,
  /** Para contar con el dia que ve quien mira. */
  zones?: DueZones,
): MineSummary {
  const limit = addDays(todayLocal, 7);
  const summary: MineSummary = { overdue: 0, today: 0, next7: 0, open: 0 };
  for (const t of tasks) {
    if (t.owner_id !== meId || t.status === "completed") continue;
    summary.open += 1;
    const due = dueSeen(t, zones).date;
    if (!due) continue;
    if (due < todayLocal) summary.overdue += 1;
    else if (due === todayLocal) summary.today += 1;
    else if (due <= limit) summary.next7 += 1;
  }
  return summary;
}
