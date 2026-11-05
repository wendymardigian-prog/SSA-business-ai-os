/**
 * Las variables de un formulario en el contexto de un flujo (F20). PURO.
 *
 *   {{form.name}} {{form.url}} {{form.type}} {{form.slug}} {{form.id}} {{form.category}}
 *   {{answer.<clave>}}     la respuesta como texto (las múltiples, unidas por ", "; las fechas, para leer)
 *   {{answer_raw.<clave>}} la respuesta tal como se guardó (una fecha en ISO, para una Llamada HTTP)
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
  /** Las preguntas de la versión con la que se respondió: la que no se respondió queda vacía, nunca `{{answer.x}}` literal. */
  fieldKeys?: readonly string[];
  /** El dominio principal de la instalación (`appUrl()`): el link a la respuesta en el panel, para el equipo. */
  baseUrl: string;
  /** La base de los links públicos del negocio (`publicBaseUrl`): el link al formulario, para un lead. */
  publicBaseUrl: string;
}

export interface FormVariables {
  form: { id: string; name: string; type: string; slug: string; url: string; category: string };
  answer: Record<string, string>;
  answer_raw: Record<string, string>;
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

/**
 * Una respuesta que es una fecha, para leerla. Se arma con los números del propio valor, sin pasar por ninguna zona:
 * «2026-10-06» es el 6 de octubre en cualquier lado (convertirla la corría un día en América), y una hora con desfase
 * («2026-11-09T19:00:00-06:00») ya dice en qué hora está escrita. Cualquier otra cosa no cambia.
 */
export function readableDateAnswer(text: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?[+-]\d{2}:\d{2})?$/.exec(text.trim());
  if (!match) return text;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return text;
  const part = (options: Intl.DateTimeFormatOptions) => date.toLocaleDateString("es", { timeZone: "UTC", ...options });
  const day = `${d} de ${part({ month: "long" })} de ${y}`;
  if (match[4] === undefined) return day;
  if (Number(match[4]) > 23 || Number(match[5]) > 59) return text;
  return `${part({ weekday: "long" })} ${day}, ${match[4]}:${match[5]}`;
}

export function formVariables(input: FormVariablesInput): FormVariables {
  const answer: Record<string, string> = {};
  const answer_raw: Record<string, string> = {};
  for (const key of input.fieldKeys ?? []) {
    answer[variableKey(key)] = "";
    answer_raw[variableKey(key)] = "";
  }
  for (const [key, stored] of Object.entries(input.submission.answers ?? {})) {
    const text = answerToText(stored?.value);
    answer[variableKey(key)] = readableDateAnswer(text);
    answer_raw[variableKey(key)] = text;
  }
  return {
    form: {
      id: input.form.id,
      name: input.form.name,
      type: input.form.type,
      slug: input.form.slug,
      url: formPublicUrl(input.publicBaseUrl, input.form.slug),
      category: input.form.category ?? "",
    },
    answer,
    answer_raw,
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
    answer_raw: {},
    submission: { id: "", url: "", created_at: "", score: "", nps_category: "", contact_created: "false" },
  };
}
