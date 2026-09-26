/**
 * Indicadores de calidad de la clasificación (F25, §13.3). Puros: reciben las
 * filas y devuelven los números. La precisión se calcula SOLO con la revisión
 * rápida; "sin categoría" se calcula sobre el VOLUMEN de mensajes, no sobre
 * textos distintos.
 */

export interface QualityText {
  category_id: string | null;
  source: "rule" | "model" | "human" | null;
  confidence: number | null;
  review_result: "ok" | "corrected" | null;
  /** Cuántos mensajes reales usan este texto (para "sin categoría" por volumen). */
  messageCount: number;
}

export interface QualityReport {
  /** Aciertos ÷ revisados, solo revisión rápida. null si no hay revisados. */
  estimatedAccuracy: number | null;
  reviewedCount: number;
  /** Filas del modelo que alguien movió después. */
  corrected: number;
  /** Parte del volumen de mensajes sin categoría o en "Otro". */
  uncategorizedMessagePct: number;
  /** Textos con confianza < 0,70. */
  lowConfidence: number;
}

export function qualityReport(texts: QualityText[], fallbackCategoryIds: Set<string>): QualityReport {
  const reviewed = texts.filter((t) => t.review_result !== null);
  const hits = reviewed.filter((t) => t.review_result === "ok").length;
  const corrected = texts.filter((t) => t.source === "model" && t.review_result === "corrected").length;

  const totalMessages = texts.reduce((s, t) => s + t.messageCount, 0);
  const uncatMessages = texts
    .filter((t) => t.category_id === null || fallbackCategoryIds.has(t.category_id))
    .reduce((s, t) => s + t.messageCount, 0);

  return {
    estimatedAccuracy: reviewed.length > 0 ? Math.round((100 * hits) / reviewed.length) / 100 : null,
    reviewedCount: reviewed.length,
    corrected,
    uncategorizedMessagePct: totalMessages > 0 ? Math.round((1000 * uncatMessages) / totalMessages) / 10 : 0,
    lowConfidence: texts.filter((t) => t.confidence !== null && t.confidence < 0.7).length,
  };
}

/** Calibración: aciertos reales por tramo de confianza (>90, 70-90, <70). §13.3 */
export function confidenceCalibration(reviewed: Array<{ confidence: number | null; review_result: "ok" | "corrected" | null }>): {
  high: { n: number; accuracy: number | null };
  mid: { n: number; accuracy: number | null };
  low: { n: number; accuracy: number | null };
} {
  const bucket = (pred: (c: number) => boolean) => {
    const rows = reviewed.filter((r) => r.confidence !== null && pred(r.confidence) && r.review_result !== null);
    const hits = rows.filter((r) => r.review_result === "ok").length;
    return { n: rows.length, accuracy: rows.length > 0 ? Math.round((100 * hits) / rows.length) / 100 : null };
  };
  return {
    high: bucket((c) => c > 0.9),
    mid: bucket((c) => c >= 0.7 && c <= 0.9),
    low: bucket((c) => c < 0.7),
  };
}
