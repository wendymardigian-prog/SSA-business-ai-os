/**
 * Lo que muestra la pantalla de Tareas en segundo plano (F23, F25).
 *
 * Puro: recibe la configuracion, las corridas y el gasto, y devuelve las filas.
 * El ahorro estimado y "la ultima corrida" son cuentas que conviene poder
 * probar, no cuentas escondidas en el JSX.
 */

import { AI_TASKS } from "@/lib/ai-tasks/catalog";
import { BACKGROUND_TASKS, type BackgroundSettings, type BackgroundTask, type TaskFrequency, type TaskMode } from "./settings";

/**
 * Nombre y descripcion salen del catalogo de Agentes IA (`AI_TASKS`): antes
 * eran una segunda copia que se podia desincronizar. Aca queda solo lo propio
 * de esta pantalla: el aviso de pasar a Económico.
 */
const BATCH_WARNINGS: Partial<Record<BackgroundTask, string>> = {
  conversation_summary:
    "En modo económico, si el contacto vuelve a escribir antes de la corrida, el agente no tiene la memoria actualizada.",
  close_classification: "En modo económico, un lead que se calentó hoy aparece como caliente recién mañana.",
};

export const TASK_LABELS: Record<BackgroundTask, { name: string; description: string; batchWarning?: string }> = Object.fromEntries(
  BACKGROUND_TASKS.map((task) => [task, { name: AI_TASKS[task].name, description: AI_TASKS[task].description, batchWarning: BATCH_WARNINGS[task] }]),
) as Record<BackgroundTask, { name: string; description: string; batchWarning?: string }>;

export const MODE_LABELS: Record<TaskMode, string> = { now: "Inmediato", batch: "Económico", off: "Apagado" };
export const FREQUENCY_LABELS: Record<TaskFrequency, string> = {
  daily: "Una vez por día",
  every6h: "Cada 6 horas",
  hourly: "Cada hora",
  weekly: "Una vez por semana",
};

/** La tarea que no se puede apagar: sin documentos indexados el agente no busca. */
export const ALWAYS_ON: BackgroundTask = "knowledge_indexing";

/**
 * El `source` de `agent_runs` de cada tarea, para encontrar su ultima corrida.
 *
 * `close_classification` no tiene `source` propio: corre adentro del run de
 * `conversation_summary`. Agentes IA la encuentra filtrando por
 * `status_detail` (`AI_TASKS.close_classification.detailLike`); esta tabla,
 * que solo usa la pantalla de calidad de la clasificacion, la deja afuera.
 */
export const TASK_RUN_SOURCES = {
  message_classification: "message_classification",
  conversation_summary: "conversation_summary",
  close_classification: null,
  knowledge_indexing: "kb_indexing",
} as const satisfies Record<BackgroundTask, string | null>;

/** Los `source` que existen de verdad, para consultar `agent_runs`. */
export const TASK_RUN_SOURCE_LIST = Object.values(TASK_RUN_SOURCES).filter(
  (s): s is Exclude<(typeof TASK_RUN_SOURCES)[BackgroundTask], null> => s !== null,
);

export interface TaskRunInfo {
  /** Cuando termino la ultima corrida. */
  at: string | null;
  status: string | null;
  detail: string | null;
  /** Gasto del mes de esa tarea, en USD. null = no se sabe. */
  monthSpendUsd: number | null;
  /** Corridas del mes. null = no se sabe. Solo lo llena el resumen de Agentes IA. */
  monthRuns?: number | null;
}

export interface TaskRow {
  task: BackgroundTask;
  name: string;
  description: string;
  mode: TaskMode;
  frequency: TaskFrequency;
  hour: string;
  /** El aviso de pasar a Económico, si esa tarea tiene uno. */
  batchWarning: string | null;
  canTurnOff: boolean;
  canBatch: boolean;
  lastRun: TaskRunInfo | null;
}

/** Las cuatro filas de la tabla, en el orden de §13.1. */
export function taskRows(settings: BackgroundSettings, runs: Partial<Record<BackgroundTask, TaskRunInfo>>): TaskRow[] {
  return BACKGROUND_TASKS.map((task) => {
    const config = settings[task];
    const meta = TASK_LABELS[task];
    return {
      task,
      name: meta.name,
      description: meta.description,
      mode: config.mode,
      frequency: config.frequency ?? "daily",
      hour: config.hour ?? "03:00",
      batchWarning: meta.batchWarning ?? null,
      canTurnOff: task !== ALWAYS_ON,
      canBatch: task !== ALWAYS_ON,
      lastRun: runs[task] ?? null,
    };
  });
}

/**
 * El ahorro estimado del mes por usar el modo económico.
 *
 * Es una **estimación** y la pantalla lo dice: el descuento por lote lo aplica el
 * proveedor y solo se conoce el gasto ya hecho. Se calcula sobre lo gastado por
 * las tareas que estan en lote, con el descuento que declara el proveedor.
 */
export function estimatedSavings(
  rows: TaskRow[],
  batchDiscount: number,
): { savedUsd: number | null; batchTasks: number } {
  const batchRows = rows.filter((r) => r.mode === "batch");
  if (batchRows.length === 0) return { savedUsd: null, batchTasks: 0 };
  const spent = batchRows.reduce((sum, r) => sum + (r.lastRun?.monthSpendUsd ?? 0), 0);
  if (spent <= 0 || batchDiscount <= 0) return { savedUsd: null, batchTasks: batchRows.length };
  // Lo gastado ya lleva el descuento: lo que se ahorro es la diferencia contra
  // lo que hubiera costado sin el.
  const withoutDiscount = spent / (1 - batchDiscount);
  return { savedUsd: Math.round((withoutDiscount - spent) * 100) / 100, batchTasks: batchRows.length };
}

/** "Hoy 03:00", "Ayer 17:40", "23 sept 03:00", o que no corrio nunca. */
export function lastRunLabel(at: string | null, now: Date = new Date(), locale = "es-AR"): string {
  if (!at) return "Nunca corrió";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "Nunca corrió";

  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(date, now)) return `Hoy ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return `Ayer ${time}`;

  return `${date.toLocaleDateString(locale, { day: "numeric", month: "short" })} ${time}`;
}

/** Un monto en dolares, o una raya cuando no se sabe (nunca "USD 0"). */
export function formatSpend(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return "—";
  return `USD ${usd.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: usd < 0.01 && usd > 0 ? 4 : 2 })}`;
}
