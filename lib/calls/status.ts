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
  imported_no_ai: "Se importó sin clasificar con IA: elegí el área y el tipo",
  ai_error: "La IA no pudo clasificarla: elegí el tipo vos",
  no_profile: "Falta configurar el analizador de este tipo",
  no_show: "Nadie se presentó",
  rules: "No cumple las reglas para analizarse sola: analizala a mano si querés",
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
  hasArea: boolean;
  noShow: boolean;
  hasProfile: boolean;
  hasTranscript: boolean;
  canEdit: boolean;
}): AnalyzeCheck {
  if (!input.canEdit) return { ok: false, reason: "No tenés permiso para analizar llamadas" };
  if (!input.hasTranscript) return { ok: false, reason: "La llamada no tiene transcripción" };
  if (input.status === "analyzing") return { ok: false, reason: "Ya se está analizando" };
  if (input.status === "classifying") return { ok: false, reason: "Todavía se está clasificando" };
  if (!input.hasArea) return { ok: false, reason: "Primero elegí el área y el tipo" };
  if (input.noShow) return { ok: false, reason: "Nadie se presentó" };
  if (!input.hasProfile) return { ok: false, reason: "Falta configurar el analizador de este tipo" };
  return { ok: true };
}
