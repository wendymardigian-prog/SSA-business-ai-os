/**
 * Lógica pura del formulario público (F9): lo que el componente decide.
 * Sin React: así se prueba entero con Vitest.
 */
import type { FormField } from "./fields";
import type { PublicField } from "./public-definition";
import { MESSAGES } from "./submission-schema";

export interface PublicFormData {
  status: "available";
  slug: string;
  type: "custom" | "survey" | "contract";
  version_id: string;
  design: { title?: string; intro?: string; submitLabel?: string; showLogo?: boolean };
  fields: PublicField[];
  contract: { text: string | null; version_number: number; title?: string | null; accept_label?: string | null } | null;
  signature_required: boolean;
  survey: { scoreFieldKey?: string | null } | null;
  turnstile_site_key: string | null;
}

export type PublicFormResult = PublicFormData | { status: "unavailable" };

export function isAvailable(form: PublicFormResult | null | undefined): form is PublicFormData {
  return !!form && form.status === "available";
}

/** Lo que devuelve `get_public_form` como `FormField[]` completos (con valores por defecto). */
export function toFormFields(fields: PublicField[]): FormField[] {
  return fields.map((f, index) => ({
    id: `p${index}`,
    key: f.key,
    type: f.type,
    label: f.label ?? f.key,
    help: f.help,
    placeholder: f.placeholder,
    required: f.required ?? false,
    options: f.options,
    min: f.min,
    max: f.max,
    file: f.file,
    consentText: f.consentText,
    hidden: f.hidden ? { source: f.hidden.source, param: f.hidden.param } : undefined,
    visibility: f.visibility,
    prefill: f.prefill,
  }));
}

export const DEFAULT_SUBMIT_LABEL = "Enviar";

export function submitLabelOf(design: PublicFormData["design"] | null | undefined, type: PublicFormData["type"]): string {
  const custom = design?.submitLabel?.trim();
  if (custom) return custom;
  return type === "contract" ? "Firmar y enviar" : DEFAULT_SUBMIT_LABEL;
}

// ── Respuestas del servidor ──────────────────────────────────────────────────

export type SubmitFailure =
  | { kind: "fields"; fields: Record<string, string>; message: string }
  | { kind: "already_answered"; message: string }
  | { kind: "form_changed"; message: string }
  | { kind: "captcha"; message: string; retryable: true }
  | { kind: "unavailable"; message: string }
  | { kind: "general"; message: string };

export function describeFailure(status: number, body: unknown): SubmitFailure {
  const data = (body && typeof body === "object" ? body : {}) as { error?: string; message?: string; fields?: Record<string, string> };
  const message = typeof data.message === "string" && data.message ? data.message : "";

  if (status === 400 && data.error === "invalid" && data.fields) {
    return { kind: "fields", fields: data.fields, message: message || "Revisá los campos marcados." };
  }
  if (data.error === "already_answered") return { kind: "already_answered", message: message || "Ya respondiste, ¡gracias!" };
  if (data.error === "form_changed") return { kind: "form_changed", message: message || "El formulario cambió: recargá la página." };
  if (data.error === "captcha_failed" || data.error === "captcha_unavailable") {
    return { kind: "captcha", message: message || "No pudimos verificar que sos una persona. Probá de nuevo.", retryable: true };
  }
  if (status === 404) return { kind: "unavailable", message: "Este formulario no está disponible." };
  if (status === 429) return { kind: "general", message: message || "Hiciste demasiados envíos. Probá de nuevo más tarde." };
  return { kind: "general", message: message || "No pudimos enviar tu respuesta. Probá de nuevo." };
}

// ── Archivos en el navegador (feedback rápido; el servidor vuelve a verificar) ─

export interface FileLike {
  name: string;
  size: number;
  type: string;
}

export function checkClientFiles(field: Pick<FormField, "file" | "required">, files: FileLike[]): string | null {
  if (files.length === 0) return field.required ? MESSAGES.file : null;
  const rule = field.file;
  if (!rule) return null;
  if (files.length > rule.maxFiles) return `Podés subir hasta ${rule.maxFiles} archivo${rule.maxFiles === 1 ? "" : "s"}`;
  for (const file of files) {
    if (file.size > rule.maxMb * 1024 * 1024) return `El archivo pesa más de ${rule.maxMb} MB`;
    if (file.type && !rule.accept.includes(file.type)) return "Ese tipo de archivo no está permitido";
  }
  return null;
}

// ── El pedido ────────────────────────────────────────────────────────────────

export interface PayloadInput {
  idempotencyKey: string;
  turnstileToken: string;
  versionId: string;
  answers: Record<string, unknown>;
  honeypot: string;
  attribution: Record<string, unknown>;
  timezone?: string;
  locale?: string;
  screen?: string;
  origin: "public_page" | "embed" | "site";
  sitePath?: string;
  linkToken?: string;
  signature?: string;
  signatureStrokes?: number;
  accepted?: boolean;
}

export function buildPayload(input: PayloadInput): Record<string, unknown> {
  return {
    idempotency_key: input.idempotencyKey,
    turnstile_token: input.turnstileToken,
    version_id: input.versionId,
    answers: input.answers,
    honeypot: input.honeypot,
    attribution: input.attribution,
    client_meta: {
      ...(input.timezone ? { timezone: input.timezone } : {}),
      ...(input.locale ? { locale: input.locale } : {}),
      ...(input.screen ? { screen: input.screen } : {}),
    },
    origin: input.origin,
    ...(input.sitePath ? { site_path: input.sitePath } : {}),
    ...(input.linkToken ? { link_token: input.linkToken } : {}),
    ...(input.signature ? { signature: input.signature, signature_strokes: input.signatureStrokes ?? 0 } : {}),
    ...(input.accepted !== undefined ? { accepted: input.accepted } : {}),
  };
}

export function buildSubmitFormData(payload: Record<string, unknown>, files: Record<string, File[]>): FormData {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  for (const [key, list] of Object.entries(files)) {
    for (const file of list) form.append(`file:${key}`, file, file.name);
  }
  return form;
}

/** Las respuestas del navegador como las espera el servidor: números como números. */
export function answersForSubmit(fields: FormField[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === "file") continue;
    const value = values[field.key];
    if (value === undefined || value === null || value === "") continue;
    if ((field.type === "number" || field.type === "rating" || field.type === "nps") && typeof value === "string") {
      const n = Number(value);
      out[field.key] = Number.isFinite(n) ? n : value;
    } else {
      out[field.key] = value;
    }
  }
  return out;
}

/** Los parámetros de una URL como mapa plano (el primero de cada nombre gana). */
export function paramsToRecord(search: string | URLSearchParams): Record<string, string> {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    if (!(key in out)) out[key] = value;
  });
  return out;
}
