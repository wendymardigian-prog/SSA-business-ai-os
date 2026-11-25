// @plantilla-quitar(servicios)
/**
 * Encuestas en las actividades (00512), PURO: qué respuesta vale para una pregunta de estrellas o de opciones.
 *
 * Gemela de `app_servicio_portal.activity_answers_valid` (la llama `portal_submit` antes de guardar una entrega), con los
 * mismos casos en `activity-answers.cases.json`. Si se cambia una regla, se cambian las dos y se suma el caso.
 *
 * - Una respuesta que no está o es `null` siempre vale acá (lo obligatorio lo mira otro chequeo).
 * - Estrellas (`rating`): un número entero entre `min` y `max` de la pregunta (1 y 5 si no los trae).
 * - Selección única: un texto que es una de las opciones (o vacío = sin responder).
 * - Selección múltiple: una lista de textos, todos opciones.
 * - Una pregunta de opciones sin opciones guardadas acepta cualquier texto (no rompe una definición vieja).
 * - Los demás tipos no se miran acá.
 */

export interface AnswerField {
  key: string;
  type: string;
  options?: unknown;
  min?: unknown;
  max?: unknown;
}

/** La escala de estrellas de las actividades: la misma que `rating` de Formularios (`lib/forms/fields.ts`). */
export const RATING_MIN = 1;
export const RATING_MAX = 5;

const bound = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const optionsOf = (f: AnswerField): unknown[] => (Array.isArray(f.options) ? f.options : []);
const isOption = (opts: unknown[], v: unknown) => opts.length === 0 || opts.some((o) => o === v);

export function ratingBounds(f: Pick<AnswerField, "min" | "max">): { min: number; max: number } {
  return { min: bound(f.min, RATING_MIN), max: bound(f.max, RATING_MAX) };
}

function fieldAnswerValid(f: AnswerField, v: unknown): boolean {
  if (v === undefined || v === null) return true;
  switch (f.type) {
    case "rating": {
      const { min, max } = ratingBounds(f);
      return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
    }
    case "single_select":
      return typeof v === "string" && (v === "" || isOption(optionsOf(f), v));
    case "multi_select":
      return Array.isArray(v) && v.every((x) => typeof x === "string" && isOption(optionsOf(f), x));
    default:
      return true;
  }
}

/** true si todas las respuestas de estrellas y de opciones son de su pregunta. */
export function activityAnswersValid(fields: readonly AnswerField[], answers: Record<string, unknown>): boolean {
  return fields.every((f) => fieldAnswerValid(f, answers[f.key]));
}
