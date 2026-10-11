/**
 * Las categorías de una encuesta (F22). Lista en código, editable acá; CX usa
 * `servicio`. Vive aparte para que la lógica de triggers no arrastre el resto.
 */
export const SURVEY_CATEGORIES = ["servicio", "llamada", "onboarding", "cierre", "general"] as const;
export type SurveyCategory = (typeof SURVEY_CATEGORIES)[number];

export const SURVEY_CATEGORY_LABELS: Record<SurveyCategory, string> = {
  servicio: "Servicio",
  llamada: "Llamada",
  onboarding: "Onboarding",
  cierre: "Cierre",
  general: "General",
};
