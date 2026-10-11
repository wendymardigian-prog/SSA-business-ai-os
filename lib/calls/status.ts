/**
 * Los estados del analisis de una llamada y sus transiciones (F22). Puro.
 *
 *  Clasificando (`classifying`) -> Por revisar (`needs_review`) | Pendiente
 *  (`pending`) | No aplica (`not_applicable`) -> Analizando (`analyzing`) ->
 *  Analizada (`analyzed`) | Error (`error`).
 *
 * `pending` lleva un MOTIVO: `manual` (el automatico esta apagado: espera que
 * alguien toque Analizar), `budget` (frenada por el tope de gasto), `stuck`
 * (se trabo y volvio a la fila).
 */

import type { CallAnalysisStatus } from "@/lib/types/database";

export const STATUS_LABELS: Record<CallAnalysisStatus, string> = {
  classifying: "Clasificando…",
  needs_review: "Por revisar",
  pending: "Pendiente",
  analyzing: "Analizando…",
  analyzed: "Analizada",
  not_applicable: "No aplica",
  error: "Error",
};

export function statusLabel(status: string | null | undefined): string {
  return (status && STATUS_LABELS[status as CallAnalysisStatus]) || "Pendiente";
}

const REASONS: Record<string, string> = {
  manual: "Esperando que alguien la analice",
  budget: "Frenada por el tope de gasto de IA",
  low_confidence: "La IA no está segura del tipo: confirmalo vos",
  stuck: "Se trabó y vuelve a la fila",
  schema: "La IA devolvió un análisis incompleto",
  no_transcript: "No tiene transcripción",
  rule: "El tipo lo decidió una regla",
  ai_off: "Ninguna regla lo decide y la clasificación con IA está apagada",
  ai_error: "La IA no pudo clasificarla: elegí el tipo vos",
};

/** El motivo en palabras, o null si no hay (o no se conoce). */
export function statusReasonText(status: string | null | undefined, reason: string | null | undefined): string | null {
  void status;
  if (!reason) return null;
  return REASONS[reason] ?? null;
}

export interface AnalyzeCheck {
  ok: boolean;
  /** Por que no, en palabras (para el tooltip del boton deshabilitado). */
  reason?: string;
}

/** Si el boton "Analizar" se ofrece, y si no, por que. */
export function canAnalyze(input: {
  status: CallAnalysisStatus;
  callType: string | null;
  analyzeTypes: string[];
  hasTranscript: boolean;
  canEdit: boolean;
}): AnalyzeCheck {
  if (!input.canEdit) return { ok: false, reason: "No tenés permiso para analizar llamadas" };
  if (!input.hasTranscript) return { ok: false, reason: "La llamada no tiene transcripción" };
  if (input.status === "analyzing") return { ok: false, reason: "Ya se está analizando" };
  if (input.status === "classifying") return { ok: false, reason: "Todavía se está clasificando" };
  if (!input.callType) return { ok: false, reason: "Primero elegí el tipo de llamada" };
  if (!input.analyzeTypes.includes(input.callType)) return { ok: false, reason: "Este tipo de llamada no se analiza" };
  return { ok: true };
}

export interface AfterClassify {
  status: Extract<CallAnalysisStatus, "needs_review" | "pending" | "not_applicable">;
  reason: string | null;
  /** Se encola el analisis ahora (modo automatico). */
  enqueueAnalysis: boolean;
}

/**
 * El estado en que queda la llamada despues de clasificarla.
 *  - Confianza baja: Por revisar.
 *  - Tipo que no se analiza: No aplica.
 *  - Tipo que si: Pendiente; con el modo automatico se encola, y sin el queda
 *    esperando (motivo `manual`).
 */
export function nextStatusAfterClassify(
  callType: string,
  opts: { analyzeTypes: string[]; auto: boolean; lowConfidence?: boolean; hasTranscript?: boolean },
): AfterClassify {
  if (opts.lowConfidence) return { status: "needs_review", reason: "low_confidence", enqueueAnalysis: false };
  if (!opts.analyzeTypes.includes(callType) && callType !== "venta") return { status: "not_applicable", reason: null, enqueueAnalysis: false };
  if (opts.hasTranscript === false) return { status: "needs_review", reason: "no_transcript", enqueueAnalysis: false };
  return opts.auto
    ? { status: "pending", reason: null, enqueueAnalysis: true }
    : { status: "pending", reason: "manual", enqueueAnalysis: false };
}
