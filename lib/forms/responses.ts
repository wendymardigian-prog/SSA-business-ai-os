/**
 * Lógica pura de la tabla de respuestas (F13).
 *
 * Las respuestas guardan la ETIQUETA con la que se respondió, así que renombrar
 * o borrar un campo no deja las viejas sin sentido: la tabla muestra la columna
 * de un campo que ya no existe, con su etiqueta más reciente.
 */
import type { FormField, FormType } from "./fields";

export type SubmissionStatus = "received" | "no_contact" | "spam";

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  received: "Recibida",
  no_contact: "Sin contacto",
  spam: "Spam",
};

export interface StoredAnswer {
  label: string;
  type: string;
  value: unknown;
}

export interface ResponseRow {
  id: string;
  created_at: string;
  status: SubmissionStatus;
  contact_id: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  answers: Record<string, StoredAnswer>;
  score?: number | null;
  nps_category?: string | null;
  attribution?: Record<string, unknown> | null;
  /** Solo contratos: estado del email con la copia firmada. */
  email_status?: string | null;
}

export interface ResponseColumn {
  key: string;
  label: string;
  type: string;
  /** El campo ya no existe en la versión vigente. */
  removed: boolean;
}

/**
 * Una columna por cada campo de la versión vigente y, al final, una por cada
 * campo que ya no está pero tiene respuestas. La etiqueta es la MÁS RECIENTE.
 * `submissions` viene ordenado de la más nueva a la más vieja.
 */
export function responseColumns(
  currentFields: Array<Pick<FormField, "key" | "label" | "type">>,
  submissions: Array<Pick<ResponseRow, "answers">>,
): ResponseColumn[] {
  const columns: ResponseColumn[] = [];
  const seen = new Set<string>();
  for (const field of currentFields) {
    if (field.type === "hidden" && !submissions.some((s) => field.key in (s.answers ?? {}))) continue;
    columns.push({ key: field.key, label: field.label, type: field.type, removed: false });
    seen.add(field.key);
  }
  for (const submission of submissions) {
    for (const [key, answer] of Object.entries(submission.answers ?? {})) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push({ key, label: answer.label || key, type: answer.type, removed: true });
    }
  }
  return columns;
}

/** Cualquier valor de respuesta en texto plano legible. */
export function answerToText(raw: unknown, joiner = ", "): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (typeof raw === "boolean") return raw ? "Sí" : "No";
  if (Array.isArray(raw)) {
    return raw
      .map((v) => answerToText(v, joiner))
      .filter(Boolean)
      .join(joiner);
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    // Archivos: `{ path, name, size, mime }` → el nombre, nunca la ruta del bucket.
    if ("name" in obj && "path" in obj) return String(obj.name ?? "");
    if ("value" in obj) return answerToText(obj.value, joiner);
    if ("label" in obj && obj.label != null && obj.label !== "") return answerToText(obj.label, joiner);
    return JSON.stringify(obj);
  }
  return String(raw);
}

export function cellFor(row: Pick<ResponseRow, "answers">, column: Pick<ResponseColumn, "key">, joiner = ", "): string {
  const answer = row.answers?.[column.key];
  return answer ? answerToText(answer.value, joiner) : "";
}

export function statusLabel(status: SubmissionStatus): string {
  return SUBMISSION_STATUS_LABELS[status] ?? status;
}

const EMAIL_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  sent: "Enviado",
  retrying: "Reintentando",
  not_sent: "No enviado",
};

export function emailStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return EMAIL_STATUS_LABELS[status] ?? status;
}

export interface ResponseFilters {
  from?: string | null;
  to?: string | null;
  status?: SubmissionStatus | "all" | null;
  contact?: "with" | "without" | "all" | null;
  page: number;
}

const STATUSES = new Set<string>(["received", "no_contact", "spam"]);

/** Los filtros de la URL, validados. */
export function parseResponseFilters(params: Record<string, string | string[] | undefined>): ResponseFilters {
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const date = (k: string) => {
    const v = one(k);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  };
  const status = one("estado");
  const contact = one("contacto");
  // `page` es el que usa la paginación del dashboard; `pagina` queda como alias.
  const page = Number(one("page") ?? one("pagina"));
  return {
    from: date("desde"),
    to: date("hasta"),
    status: status && STATUSES.has(status) ? (status as SubmissionStatus) : "all",
    contact: contact === "con" ? "with" : contact === "sin" ? "without" : "all",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

export function formTypeHasScoreColumn(type: FormType): boolean {
  return type === "survey";
}

/**
 * Las respuestas en el orden en que se preguntaron (el de la versión con la que
 * se respondió); los campos que ya no están, al final. La base devuelve las
 * claves de un jsonb en un orden propio que no sirve para mostrar.
 */
export function orderedAnswers(
  answers: Record<string, StoredAnswer>,
  fieldOrder: string[],
): Array<[string, StoredAnswer]> {
  const known = fieldOrder.filter((key) => key in answers).map((key) => [key, answers[key]] as [string, StoredAnswer]);
  const rest = Object.entries(answers).filter(([key]) => !fieldOrder.includes(key));
  return [...known, ...rest];
}
