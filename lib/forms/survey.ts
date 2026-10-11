/**
 * Lo propio de una encuesta (F22): la configuración, la categoría del NPS y el
 * puntaje de una respuesta. PURO.
 *
 * `npsCategory` tiene un espejo en la base (la RPC `submit_form_response` calcula
 * `score` y `nps_category` desde las respuestas ya validadas); el test de paridad
 * de `verify-forms.mjs` los compara.
 */
import { z } from "zod";
import { isScoreType, type FormField } from "./fields";
import { SURVEY_CATEGORIES, SURVEY_CATEGORY_LABELS, type SurveyCategory } from "./survey-categories";
import type { SurveyConfig } from "./defaults";

export { SURVEY_CATEGORIES, SURVEY_CATEGORY_LABELS };
export type { SurveyCategory, SurveyConfig };

export type NpsCategory = "promoter" | "passive" | "detractor";

export const NPS_CATEGORY_LABELS: Record<NpsCategory, string> = {
  promoter: "Promotor",
  passive: "Pasivo",
  detractor: "Detractor",
};

/** 9-10 promotor · 7-8 pasivo · 0-6 detractor. */
export function npsCategory(score: number): NpsCategory {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

const schema = z.object({
  scoreFieldKey: z.string().trim().min(1).max(60),
  category: z.enum(SURVEY_CATEGORIES),
  oncePerContact: z.boolean(),
});

export type SurveyConfigResult = { ok: true; config: SurveyConfig } | { ok: false; errors: string[] };

/** Valida la configuración contra los campos del borrador: el puntaje tiene que ser un campo de estrellas o NPS, obligatorio. */
export function validateSurveyConfig(input: unknown, fields: FormField[]): SurveyConfigResult {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: ["La configuración de la encuesta no es válida"] };
  const config = parsed.data;
  const field = fields.find((f) => f.key === config.scoreFieldKey);
  if (!field) return { ok: false, errors: ["Elegí el campo que lleva el puntaje"] };
  if (!isScoreType(field.type)) return { ok: false, errors: [`"${field.label}" no es un campo de estrellas ni de NPS`] };
  if (!field.required) return { ok: false, errors: [`"${field.label}" tiene que ser obligatorio: es el puntaje de la encuesta`] };
  return { ok: true, config };
}

/** La configuración guardada, o la de por defecto si está rota (nunca lanza). */
export function parseStoredSurveyConfig(raw: unknown): SurveyConfig | null {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Los campos que pueden llevar el puntaje: estrellas o NPS, y obligatorios. */
export function scoreCandidates(fields: FormField[]): FormField[] {
  return fields.filter((f) => isScoreType(f.type) && f.required);
}

/** La escala de la encuesta según el tipo del campo de puntaje. */
export function scaleOf(field: Pick<FormField, "type"> | undefined): "nps" | "stars" {
  return field?.type === "rating" ? "stars" : "nps";
}

/**
 * El puntaje de una respuesta guardada (`{ type, value }` por campo): el entero y,
 * solo si el campo es NPS, su categoría. Es lo mismo que calcula la RPC.
 */
export function scoreOfAnswers(
  scoreFieldKey: string | null | undefined,
  answers: Record<string, { type?: string; value?: unknown } | undefined>,
): { score: number | null; category: NpsCategory | null } {
  if (!scoreFieldKey) return { score: null, category: null };
  const answer = answers[scoreFieldKey];
  const value = answer?.value;
  if (typeof value !== "number" || !Number.isFinite(value)) return { score: null, category: null };
  const score = Math.round(value);
  return { score, category: answer?.type === "nps" ? npsCategory(score) : null };
}
