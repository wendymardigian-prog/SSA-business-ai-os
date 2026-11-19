

/**
 * El tope mensual de gasto (USD) de cada tarea de IA (`workspaces.ai_task_limits`, 00440).
 *
 * Avisa una vez al pasar el porcentaje de aviso (el del negocio o, sin valor, el 80 %) y, al llegar, FRENA: la tarea
 * no llama al modelo hasta el mes siguiente (`withinWorkspaceBudget` con `task`, lib/ai/workspace-budget.ts). Sin
 * tope guardado, «Sin tope» y nada cambia. Traído de RER, sin el tamaño de lote.
 */

export interface TaskLimits {
  monthlyCapUsd: number | null;
}

const EMPTY: TaskLimits = { monthlyCapUsd: null };

function nonNegative(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

/** Lo guardado de una tarea. Cualquier cosa rara se lee como «sin valor», nunca como 0. */
export function taskLimitsOf(raw: unknown, task: string): TaskLimits {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY;
  const entry = (raw as Record<string, unknown>)[task];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return EMPTY;
  return { monthlyCapUsd: nonNegative((entry as Record<string, unknown>).monthly_cap_usd) };
}

export type CapLight = "green" | "yellow" | "red";

export interface CapStatus {
  /** `null`: sin tope guardado. */
  capUsd: number | null;
  /** `null`: no se pudo leer el gasto (sin dato, nunca 0). */
  spentUsd: number | null;
  /** Porcentaje usado, redondeado. `null` sin tope o sin gasto leído. */
  pct: number | null;
  light: CapLight | null;
}

export const CAP_WARN_PCT = 80;

export function capStatus(capUsd: number | null, spentUsd: number | null): CapStatus {
  if (capUsd === null || spentUsd === null) return { capUsd, spentUsd, pct: null, light: null };
  if (capUsd === 0) return { capUsd, spentUsd, pct: spentUsd > 0 ? 100 : 0, light: spentUsd > 0 ? "red" : "green" };
  const pct = Math.round((spentUsd / capUsd) * 100);
  return { capUsd, spentUsd, pct, light: pct >= 100 ? "red" : pct >= CAP_WARN_PCT ? "yellow" : "green" };
}

/** Valida lo que llega del formulario. Vacío = quitar el tope. */
export function parseCapInput(raw: string): { ok: true; monthlyCapUsd: number | null } | { ok: false; error: string } {
  const text = raw.trim().replace(",", ".");
  if (text === "") return { ok: true, monthlyCapUsd: null };
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return { ok: false, error: "El tope tiene que ser un monto entre 0 y 100.000 USD." };
  return { ok: true, monthlyCapUsd: Math.round(n * 100) / 100 };
}

