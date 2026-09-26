import { dueWindow, dispatchDedupeKey } from "./dispatch";
import type { BackgroundSettings, BackgroundTask } from "./settings";

export interface PlannedDispatch {
  task: BackgroundTask;
  window: string;
  dedupeKey: string;
}

/**
 * Qué tareas en modo Económico tienen una ventana que despachar ahora (F24).
 * Devuelve el dedupe_key por tarea: correr el cron dos veces en la misma
 * ventana no crea dos corridas (el índice único de scheduled_jobs lo descarta).
 */
export function planDispatch(workspaceId: string, settings: BackgroundSettings, now: Date, timeZone: string): PlannedDispatch[] {
  const out: PlannedDispatch[] = [];
  for (const task of Object.keys(settings) as BackgroundTask[]) {
    const cfg = settings[task];
    if (cfg.mode !== "batch" || !cfg.frequency) continue;
    const window = dueWindow(cfg.frequency, cfg.hour ?? "03:00", now, timeZone);
    if (!window) continue;
    out.push({ task, window, dedupeKey: dispatchDedupeKey(workspaceId, task, window) });
  }
  return out;
}
