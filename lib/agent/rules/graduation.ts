import type { Rule } from "./evaluate";

/**
 * Sugerencia de "graduar" una categoría de intención a envío directo (F26).
 * Cuando una categoría junta ≥20 borradores finales en 30 días y ≥85% se
 * aprobaron sin cambios, se ofrece crear una regla que la envíe directo. La
 * regla se arma y se deja lista para simular; NO se guarda.
 */
export const GRADUATION_MIN_DRAFTS = 20;
export const GRADUATION_MIN_APPROVED_PCT = 85;

export interface CategoryDraftStats {
  categoryId: string;
  categoryName: string;
  finalDrafts: number;
  approvedUnchanged: number;
}

export function approvedUnchangedPct(stats: CategoryDraftStats): number {
  return stats.finalDrafts > 0 ? Math.round((1000 * stats.approvedUnchanged) / stats.finalDrafts) / 10 : 0;
}

export function qualifiesForGraduation(stats: CategoryDraftStats): boolean {
  return stats.finalDrafts >= GRADUATION_MIN_DRAFTS && approvedUnchangedPct(stats) >= GRADUATION_MIN_APPROVED_PCT;
}

/** La regla que arma el botón "¿Crear una regla para enviarlas directo?". */
export function graduationRule(stats: CategoryDraftStats, idFactory: () => string = () => `r_${Date.now()}`): Rule {
  return {
    id: idFactory(),
    name: `Enviar directo: ${stats.categoryName}`,
    enabled: true,
    action: "send",
    conditions: [{ field: "intent.category", op: "is", value: { category_id: stats.categoryId, min_confidence: 0.8 } }],
  };
}
