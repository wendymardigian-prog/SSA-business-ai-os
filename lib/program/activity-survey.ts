// @plantilla-quitar(servicios)
/**
 * Encuestas en las actividades, PURO: cómo se lee una respuesta de estrellas en la revisión y el resumen de cada
 * pregunta de estrellas (promedio y cuántas respuestas), con la última entrega de cada estudiante.
 *
 * El promedio sale de `calculateAverage` de Formularios: una sola cuenta para todo el sistema, y sin respuestas es
 * `null` (la pantalla dice «—», nunca un 0).
 */
import { calculateAverage } from "@/lib/forms/survey-metrics";
import { RATING_MAX, ratingBounds } from "./activity-answers";

/** «★★★★☆ (4)». Lo que no es un número entero de la escala se muestra tal cual (entregas viejas). */
export function ratingAnswerLabel(value: unknown, field: { min?: unknown; max?: unknown } = {}): string | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  const { min, max } = ratingBounds(field);
  if (value < min || value > max) return null;
  const top = Math.min(max, 10);
  return `${"★".repeat(Math.max(0, Math.min(value, top)))}${"☆".repeat(Math.max(0, top - value))} (${value})`;
}

export interface RatingSubmission {
  contactId: string | null;
  createdAt: string;
  answers: Record<string, unknown>;
}

export interface RatingQuestionSummary {
  key: string;
  label: string;
  average: number | null;
  responses: number;
  max: number;
}

/**
 * Una fila por pregunta de estrellas. Cuenta la última entrega de cada estudiante (si mandó dos veces, vale la nueva);
 * una entrega sin contacto cuenta sola. Una respuesta que no es un número de la escala no entra.
 */
export function ratingSummary(
  fields: ReadonlyArray<{ key: string; label: string; type: string; min?: unknown; max?: unknown }>,
  submissions: readonly RatingSubmission[],
): RatingQuestionSummary[] {
  const ratings = fields.filter((f) => f.type === "rating");
  if (ratings.length === 0) return [];
  const latest = new Map<string, RatingSubmission>();
  submissions.forEach((s, i) => {
    const k = s.contactId ?? `sin-contacto-${i}`;
    const prev = latest.get(k);
    if (!prev || prev.createdAt < s.createdAt) latest.set(k, s);
  });
  return ratings.map((f) => {
    const { min, max } = ratingBounds(f);
    const scores = [...latest.values()]
      .map((s) => s.answers?.[f.key])
      .filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max);
    return { key: f.key, label: f.label, average: calculateAverage(scores), responses: scores.length, max: max ?? RATING_MAX };
  });
}
