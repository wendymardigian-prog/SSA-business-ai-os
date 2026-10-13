/**
 * Los tres triggers de Formularios (F19) y sus filtros, como funciones puras.
 *
 * El registro (`lib/flow-engine/registry/form-triggers.ts`) los declara; la
 * lógica de "¿esta respuesta le corresponde a este trigger?" vive acá para
 * probarla sin base ni cron.
 *
 *   form_submitted   se envió un formulario personalizado
 *   survey_answered  se respondió una encuesta
 *   contract_signed  se firmó un contrato (la firma quedó guardada, no espera al PDF)
 *
 * Un solo evento por respuesta, según el tipo del formulario: así un mismo envío
 * no dispara dos veces.
 */
import type { FormType, PublicFormType } from "@/lib/forms/fields";
import { evaluateVisibility, type Answers, type AnswerValue } from "@/lib/forms/visibility";
import { parseFormTriggerConfig } from "./trigger-config";

export const FORM_TRIGGER_TYPES = ["form_submitted", "survey_answered", "contract_signed"] as const;
export type FormTriggerType = (typeof FORM_TRIGGER_TYPES)[number];

export const FORM_TRIGGER_LABELS: Record<FormTriggerType, string> = {
  form_submitted: "Se envió un formulario",
  survey_answered: "Se respondió una encuesta",
  contract_signed: "Se firmó un contrato",
};

export function isFormTriggerType(value: unknown): value is FormTriggerType {
  return typeof value === "string" && (FORM_TRIGGER_TYPES as readonly string[]).includes(value);
}

/** El evento (y el trigger) que le toca a cada tipo de formulario. */
export const TRIGGER_FOR_FORM_TYPE: Record<PublicFormType, FormTriggerType> = {
  custom: "form_submitted",
  survey: "survey_answered",
  contract: "contract_signed",
};

/** Lo que el evento de automatización trae de la respuesta (SOLO escalares, ver 00156). */
export interface FormEventPayload {
  submission_id: string;
  form_id: string;
  form_type: string;
  score?: number | string | null;
  nps_category?: string | null;
  [key: string]: unknown;
}

/** La respuesta ya leída de la base, lista para que los filtros la miren. */
export interface SubmissionForMatch {
  formId: string;
  score: number | null;
  npsCategory: string | null;
  /** La categoría de la encuesta (`survey_config.category`), si es una encuesta. */
  surveyCategory: string | null;
  /** Clave del campo → valor. */
  answers: Record<string, unknown>;
}

/** De lo guardado (`{label,type,value}`) a los valores que entiende `evaluateVisibility`. */
export function answersForConditions(stored: Record<string, { value?: unknown } | undefined> | null | undefined): Answers {
  const out: Answers = {};
  for (const [key, answer] of Object.entries(stored ?? {})) {
    const value = answer?.value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (Array.isArray(value) && value.every((v) => typeof v === "string")) out[key] = value as string[];
    else out[key] = undefined as AnswerValue; // archivos u otros: una condición los ve vacíos
  }
  return out;
}

export function formEventMatches(type: string, rawConfig: unknown, submission: SubmissionForMatch): boolean {
  if (!isFormTriggerType(type)) return false;
  const parsed = parseFormTriggerConfig(type, rawConfig);
  // Una configuración rota no dispara para todos: no dispara para nadie.
  if (!parsed.ok) return false;
  const config = parsed.config;

  if (config.form_ids.length > 0 && !config.form_ids.includes(submission.formId)) return false;

  if (type === "survey_answered") {
    if (config.nps_categories && config.nps_categories.length > 0) {
      if (!submission.npsCategory || !config.nps_categories.includes(submission.npsCategory as never)) return false;
    }
    if (config.survey_categories && config.survey_categories.length > 0) {
      if (!submission.surveyCategory || !config.survey_categories.includes(submission.surveyCategory)) return false;
    }
    if (config.score) {
      if (submission.score === null || !Number.isFinite(submission.score)) return false;
      const { operator, value } = config.score;
      if (operator === "lte" && !(submission.score <= value)) return false;
      if (operator === "gte" && !(submission.score >= value)) return false;
      if (operator === "eq" && !(submission.score === value)) return false;
    }
  }

  if (type !== "contract_signed" && config.answer_conditions) {
    if (!evaluateVisibility(config.answer_conditions, submission.answers as Answers)) return false;
  }
  return true;
}

/** `form:<tipo>:<respuesta>`: la misma respuesta procesada dos veces inicia el flujo una vez. */
export function formDedupeKey(type: string, submissionId: string): string {
  return `form:${type}:${submissionId}`;
}
