// @plantilla-quitar(servicios)
// Gemela de lib/portal/todayDueView.ts del portal (F128/F252): mismos casos, para que el panel arme el email igual que el portal la campana.
/** Algo que vence: un paso, una tarea, una repetición del reto o una actividad (F252). */
export interface DueItem {
  id: string;
  icon: string;
  title: string;
  detail: string;
  due_at: string;
  /** Horas de gracia después de la medianoche (el reporte del reto se carga hasta las 6:00 del día siguiente). */
  grace_hours?: number;
  done: boolean;
  action: { label: string; go?: string; challenge_day?: number };
}

/** Fecha local (AAAA-MM-DD) de un instante en una zona horaria. */
export function localDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/**
 * "Para hoy" en el panel de Avisos: lo que vence hoy en la zona del estudiante y todavía no hizo.
 * Un reporte del reto que se puede cargar hasta las 6:00 del día siguiente cuenta como de hoy (su gracia).
 */
export function todayDueView(items: DueItem[], now: Date, tz: string): DueItem[] {
  const today = localDate(now, tz);
  return items.filter((it) => {
    if (it.done) return false;
    const due = new Date(it.due_at);
    if (due.getTime() < now.getTime()) return false;
    // El día al que pertenece: el del vencimiento, corrido la gracia (6:00 de mañana → hoy).
    const day = localDate(new Date(due.getTime() - (it.grace_hours ?? 0) * 3_600_000 - 1), tz);
    return day === today;
  });
}
