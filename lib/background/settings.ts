import { z } from "zod";

/**
 * Configuración de las tareas de IA en segundo plano (F23, §13.1). Cada tarea
 * corre Inmediato ("now") o Económico por lote ("batch") con frecuencia y hora.
 * La indexación de Conocimiento no se puede apagar ni pasar a lote.
 */
export const BACKGROUND_TASKS = ["message_classification", "conversation_summary", "close_classification", "knowledge_indexing"] as const;
export type BackgroundTask = (typeof BACKGROUND_TASKS)[number];

export type TaskMode = "now" | "batch" | "off";
export type TaskFrequency = "daily" | "every6h" | "hourly" | "weekly";

export interface TaskConfig {
  mode: TaskMode;
  frequency?: TaskFrequency;
  hour?: string; // "HH:MM"
  model?: string | null;
}

export interface BackgroundSettings {
  message_classification: TaskConfig;
  conversation_summary: TaskConfig;
  close_classification: TaskConfig;
  knowledge_indexing: TaskConfig;
}

export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = {
  message_classification: { mode: "batch", frequency: "daily", hour: "03:00", model: null },
  conversation_summary: { mode: "now" },
  close_classification: { mode: "now" },
  knowledge_indexing: { mode: "now" },
};

const HOUR_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const taskSchema = z.object({
  mode: z.enum(["now", "batch", "off"]),
  frequency: z.enum(["daily", "every6h", "hourly", "weekly"]).optional(),
  hour: z.string().regex(HOUR_RE, "Hora inválida (HH:MM)").optional(),
  model: z.string().nullish(),
});

/** Combina lo guardado con los defaults: una entrada faltante usa su default. */
export function resolveBackgroundSettings(raw: unknown): BackgroundSettings {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_BACKGROUND_SETTINGS };
  for (const task of BACKGROUND_TASKS) {
    const parsed = taskSchema.safeParse(stored[task]);
    if (parsed.success) out[task] = parsed.data;
  }
  // Indexación de Conocimiento nunca queda apagada ni por lote.
  if (out.knowledge_indexing.mode !== "now") out.knowledge_indexing = { mode: "now" };
  return out;
}

export interface ValidateResult {
  ok: boolean;
  settings?: BackgroundSettings;
  error?: string;
}

/** Valida un cambio de configuración (F23). La indexación no se puede apagar. */
export function validateBackgroundSettings(raw: unknown): ValidateResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Configuración inválida" };
  const input = raw as Record<string, unknown>;
  const out = { ...DEFAULT_BACKGROUND_SETTINGS };
  for (const task of BACKGROUND_TASKS) {
    if (input[task] === undefined) continue;
    const parsed = taskSchema.safeParse(input[task]);
    if (!parsed.success) return { ok: false, error: `${task}: ${parsed.error.issues[0]?.message ?? "inválido"}` };
    if (parsed.data.mode === "batch" && !parsed.data.frequency) {
      return { ok: false, error: `${task}: el modo económico necesita una frecuencia` };
    }
    out[task] = parsed.data;
  }
  if (out.knowledge_indexing.mode !== "now") {
    return { ok: false, error: "La indexación de Conocimiento no se puede apagar ni pasar a lote" };
  }
  return { ok: true, settings: out };
}
