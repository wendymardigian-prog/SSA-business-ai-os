/**
 * Ajustes de aprendizaje de un agente (`agents.learning`, 00441). Puro: lo usan la pantalla, el prompt y las reglas.
 *
 * - `examples`: ejemplos automáticos en el prompt. APAGADO por defecto: respuesta prevista P-81 («hasta
 *   ampliar el acuerdo de datos, mandar a la IA solo los últimos mensajes»), falta confirmar con Wendy.
 * - `approvedExamples` / `editExamples`: cuántos de cada uno.
 * - `ruleThreshold`: cuántos rechazos con el mismo motivo hacen falta para proponer una regla.
 */

export interface LearningSettings {
  examples: boolean;
  approvedExamples: number;
  editExamples: number;
  ruleThreshold: number;
}

export const DEFAULT_LEARNING: LearningSettings = {
  examples: false,
  approvedExamples: 3,
  editExamples: 2,
  ruleThreshold: 3,
};

export const LEARNING_LIMITS = {
  approvedExamples: { min: 0, max: 10 },
  editExamples: { min: 0, max: 10 },
  ruleThreshold: { min: 2, max: 20 },
} as const;

function intIn(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function parseLearningSettings(raw: unknown): LearningSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_LEARNING };
  const r = raw as Record<string, unknown>;
  return {
    examples: r.examples === true,
    approvedExamples: intIn(r.approved_examples, DEFAULT_LEARNING.approvedExamples, LEARNING_LIMITS.approvedExamples.min, LEARNING_LIMITS.approvedExamples.max),
    editExamples: intIn(r.edit_examples, DEFAULT_LEARNING.editExamples, LEARNING_LIMITS.editExamples.min, LEARNING_LIMITS.editExamples.max),
    ruleThreshold: intIn(r.rule_threshold, DEFAULT_LEARNING.ruleThreshold, LEARNING_LIMITS.ruleThreshold.min, LEARNING_LIMITS.ruleThreshold.max),
  };
}

export function learningToJson(s: LearningSettings): Record<string, unknown> {
  return {
    examples: s.examples,
    approved_examples: s.approvedExamples,
    edit_examples: s.editExamples,
    rule_threshold: s.ruleThreshold,
  };
}
