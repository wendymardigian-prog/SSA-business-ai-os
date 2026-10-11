/**
 * Las variables de un formulario en el contexto de un flujo (F20). PURO.
 *
 *   {{form.name}} {{form.url}} {{form.type}} {{form.slug}} {{form.id}} {{form.category}}
 *   {{answer.<clave>}}     la respuesta como texto (las múltiples, unidas por ", ")
 *   {{submission.url}} {{submission.id}} {{submission.created_at}} {{submission.score}}
 *   {{submission.nps_category}} {{submission.contact_created}}
 *
 * Todo texto: un dato que falta queda vacío, así un mensaje no muestra
 * `{{answer.telefono}}` ni "null". Los archivos no van en `answer` (sale el
 * nombre, nunca un link).
 *
 * Las claves con guion pasan a guion bajo: el interpolador del motor solo lee
 * `\w`, igual que hace la Agenda con `schedulingLinkVariables`.
 */
import { answerToText } from "@/lib/forms/responses";

export interface FormVariablesInput {
  form: { id: string; name: string; type: string; slug: string; category?: string | null };
  submission: {
    id: string;
    created_at: string;
    score: number | null;
    nps_category: string | null;
    contact_created: boolean;
    /** Clave → `{ value }` (la forma que guarda la base). */
    answers: Record<string, { value?: unknown } | undefined>;
  };
  /** URL pública base de la app, sin barra final. */
  baseUrl: string;
}

export interface FormVariables {
  form: { id: string; name: string; type: string; slug: string; url: string; category: string };
  answer: Record<string, string>;
  submission: { id: string; url: string; created_at: string; score: string; nps_category: string; contact_created: string };
}

export const FORM_VARIABLE_KEYS = [
  "form.name",
  "form.url",
  "form.type",
  "form.category",
  "submission.url",
  "submission.created_at",
  "submission.score",
  "submission.nps_category",
] as const;

export function variableKey(fieldKey: string): string {
  return fieldKey.replace(/-/g, "_");
}

export function formPublicUrl(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/$/, "")}/f/${slug}`;
}

export function submissionUrl(baseUrl: string, formId: string, submissionId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/dashboard/formularios/${formId}/respuestas/${submissionId}`;
}

export function formVariables(input: FormVariablesInput): FormVariables {
  const answer: Record<string, string> = {};
  for (const [key, stored] of Object.entries(input.submission.answers ?? {})) answer[variableKey(key)] = answerToText(stored?.value);
  return {
    form: {
      id: input.form.id,
      name: input.form.name,
      type: input.form.type,
      slug: input.form.slug,
      url: formPublicUrl(input.baseUrl, input.form.slug),
      category: input.form.category ?? "",
    },
    answer,
    submission: {
      id: input.submission.id,
      url: submissionUrl(input.baseUrl, input.form.id, input.submission.id),
      created_at: input.submission.created_at,
      score: input.submission.score === null ? "" : String(input.submission.score),
      nps_category: input.submission.nps_category ?? "",
      contact_created: input.submission.contact_created ? "true" : "false",
    },
  };
}

/** Variables de ejemplo para el email de prueba del editor (nada real). */
export function emptyFormVariables(): FormVariables {
  return {
    form: { id: "", name: "Formulario de ejemplo", type: "custom", slug: "ejemplo", url: "", category: "" },
    answer: {},
    submission: { id: "", url: "", created_at: "", score: "", nps_category: "", contact_created: "false" },
  };
}
