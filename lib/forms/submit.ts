/**
 * El envío de un formulario público (F12). SOLO servidor.
 *
 * El orden importa, y cada paso existe por algo:
 *   1. Tope por IP (20/h) y, ya con el formulario, por formulario (5/h).
 *      Un envío cortado por el tope NO deja `form_rejected`: un ataque llenaría
 *      `analytics_events`. Lo cuenta `rate_limits`.
 *   2. Formulario disponible (versión vigente y su definición completa, con los
 *      ocultos `fixed`). No disponible → 404, también para un envío en curso.
 *   3. Forma del pedido (Zod).
 *   4. IDEMPOTENCIA, antes que el captcha: si ya existe una respuesta con esa
 *      clave se devuelve la misma sin verificar Turnstile (el token ya se
 *      consumió) ni disparar nada.
 *   5. Honeypot: lleno → éxito falso, sin guardar, con `form_rejected`.
 *   6. Turnstile en el servidor. Si Cloudflare no responde: 503 (jamás se acepta
 *      sin verificar). `timeout-or-duplicate` → se vuelve a buscar la respuesta.
 *   7. Versión: si se republicó mientras se completaba, se valida contra la
 *      vigente; si no pasa, 409 `form_changed`.
 *   8. Validación total (visibilidad recalculada, obligatorios, formatos,
 *      opciones, rangos). Lo oculto por condición se descarta.
 *   9. Archivos por su tipo REAL, a un bucket privado.
 *  10. Ocultos `fixed`: los pone el servidor.
 *  11. Guardar con la RPC (idempotente por índice único).
 *  12. Responder con la pantalla de éxito ya armada.
 *
 * Todo lo que tiene que ver con la base, el captcha y el almacenamiento entra
 * por `SubmitPorts`: así el orden se prueba entero sin tocar nada real, y
 * `verify-forms` lo corre con los puertos de verdad.
 *
 * Los logs llevan solo `form_id`, `submission_id` y el resultado: nunca
 * respuestas, emails, teléfonos ni la firma.
 */
import { z } from "zod";
import { countryFromTimezone } from "@/lib/scheduling/phone-countries";
import { sanitizeAttribution, parseCookieHeader } from "@/lib/attribution/collect";
import { COOKIE_KEYS } from "@/lib/attribution/keys";
import { sniffUploadMime } from "@/lib/content/media";
import type { LimitResult, LimitSpec } from "@/lib/antispam/rate-limit";
import { FORM_LIMITS, HOUR_MS } from "./limits";
import type { FormField, FormType } from "./fields";
import type { TurnstileResult } from "./turnstile";
import { renderSuccess, type SuccessConfig } from "./success";
import { toLabeledAnswers, validateSubmission, type NormalizedValue } from "./submission-schema";
import { answerToText } from "./responses";

// ── Lo que el servidor necesita de afuera ────────────────────────────────────

export interface LoadedForm {
  id: string;
  workspaceId: string;
  name: string;
  type: FormType;
  slug: string;
  versionId: string;
  versionNumber: number;
  /** Los campos de la versión vigente, con los ocultos `fixed` y su valor. */
  fields: FormField[];
  success: SuccessConfig;
  workspaceTimezone: string;
}

export interface ExistingSubmission {
  id: string;
  status: "received" | "no_contact" | "spam";
  answers: Record<string, { label: string; type: string; value: unknown }>;
  attribution: Record<string, unknown>;
}

export interface SaveInput {
  form: LoadedForm;
  idempotencyKey: string;
  /** Con etiqueta: `{ <key>: { label, type, value } }`. */
  answers: Record<string, { label: string; type: string; value: unknown }>;
  attribution: Record<string, unknown>;
  meta: Record<string, unknown>;
  uploadPrefix: string | null;
}

export type SaveResult =
  | { ok: true; duplicate: boolean; submissionId: string; status: string }
  | { ok: false; error: "already_answered" | "failed" };

export interface SubmitPorts {
  limit(spec: LimitSpec): Promise<LimitResult>;
  limitKeys: {
    submit(ip: string): string;
    submitForm(formId: string, ip: string): string;
  };
  hashIp(ip: string): string;
  loadForm(slug: string): Promise<LoadedForm | null>;
  findSubmission(formId: string, idempotencyKey: string): Promise<ExistingSubmission | null>;
  turnstileSecret(workspaceId: string): Promise<string | null>;
  verifyTurnstile(input: { secret: string; token: string; ip: string; idempotencyKey: string }): Promise<TurnstileResult>;
  recordRejected(input: { workspaceId: string; formId: string; versionId: string; reason: "captcha" | "honeypot" }): Promise<void>;
  upload(path: string, bytes: Uint8Array, mime: string): Promise<boolean>;
  save(input: SaveInput): Promise<SaveResult>;
  newId(): string;
}

// ── Entrada y salida ─────────────────────────────────────────────────────────

export interface UploadedFile {
  fieldKey: string;
  name: string;
  /** El tipo que declaró el navegador (no se confía). */
  declaredType: string;
  bytes: Uint8Array;
}

export interface SubmitInput {
  slug: string;
  ip: string;
  userAgent: string | null;
  cookieHeader: string | null;
  payload: unknown;
  files: UploadedFile[];
}

export interface SubmitOutcome {
  status: number;
  body: Record<string, unknown>;
}

const payloadSchema = z.object({
  idempotency_key: z.string().uuid(),
  turnstile_token: z.string().min(1).max(4096),
  version_id: z.string().uuid(),
  answers: z.record(z.string(), z.unknown()),
  honeypot: z.string().max(500).optional(),
  attribution: z.unknown().optional(),
  client_meta: z
    .object({
      timezone: z.string().max(64).optional(),
      locale: z.string().max(35).optional(),
      screen: z.string().max(30).optional(),
    })
    .optional(),
  origin: z.enum(["public_page", "embed", "site"]).optional(),
  site_path: z.string().max(300).optional(),
  // Contratos y links firmados (FO2/FO3): se aceptan en la forma, se usan después.
  link_token: z.string().max(2000).optional(),
  signature: z.string().max(400_000).optional(),
  signature_strokes: z.number().int().min(0).max(10_000).optional(),
  accepted: z.boolean().optional(),
});

export type SubmitPayload = z.infer<typeof payloadSchema>;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): SubmitOutcome => ({
  status,
  body: { ok: false, error, ...extra },
});

/** El nombre del archivo tal como se muestra: sin rutas ni caracteres raros. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "archivo";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
  return cleaned || "archivo";
}

function successBody(form: LoadedForm, submissionId: string, values: Record<string, unknown>, attribution: Record<string, unknown>) {
  const texts: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) texts[key] = answerToText(value);
  return renderSuccess(
    form.success,
    {
      formName: form.name,
      answers: texts,
      submissionId,
      attribution: attribution as Record<string, string | undefined>,
    },
    { escape: false },
  );
}

function duplicateOutcome(form: LoadedForm, existing: ExistingSubmission): SubmitOutcome {
  const values: Record<string, unknown> = {};
  for (const [key, answer] of Object.entries(existing.answers ?? {})) values[key] = answer.value;
  return {
    status: 200,
    body: {
      ok: true,
      duplicate: true,
      submission_id: existing.id,
      success: successBody(form, existing.id, values, existing.attribution ?? {}),
    },
  };
}

function logResult(formId: string, result: string, submissionId?: string) {
  // Sin respuestas, emails, teléfonos ni firma: solo ids y el resultado.
  console.info(`[forms] submit form=${formId} result=${result}${submissionId ? ` submission=${submissionId}` : ""}`);
}

// ── El envío ─────────────────────────────────────────────────────────────────

export async function submitForm(ports: SubmitPorts, input: SubmitInput): Promise<SubmitOutcome> {
  // 1. Tope por IP (total).
  const ipLimit = await ports.limit({
    key: ports.limitKeys.submit(input.ip),
    max: FORM_LIMITS.submitPerIpPerHour,
    windowMs: HOUR_MS,
  });
  if (!ipLimit.allowed) return fail(429, "rate_limited", { message: "Hiciste demasiados envíos. Probá de nuevo más tarde." });

  // 2. Formulario disponible.
  const form = await ports.loadForm(input.slug);
  if (!form) return fail(404, "unavailable");

  const formLimit = await ports.limit({
    key: ports.limitKeys.submitForm(form.id, input.ip),
    max: FORM_LIMITS.submitPerIpPerFormPerHour,
    windowMs: HOUR_MS,
  });
  if (!formLimit.allowed) return fail(429, "rate_limited", { message: "Hiciste demasiados envíos de este formulario. Probá de nuevo más tarde." });

  // 3. Forma del pedido.
  const parsed = payloadSchema.safeParse(input.payload);
  if (!parsed.success) return fail(400, "invalid_request", { message: "El envío no es válido. Recargá la página e intentá de nuevo." });
  const payload = parsed.data;

  // 4. Idempotencia, antes que el captcha.
  const already = await ports.findSubmission(form.id, payload.idempotency_key);
  if (already) {
    logResult(form.id, "duplicate", already.id);
    return duplicateOutcome(form, already);
  }

  // 5. Honeypot: éxito falso, sin guardar.
  if (payload.honeypot && payload.honeypot.trim() !== "") {
    await ports.recordRejected({ workspaceId: form.workspaceId, formId: form.id, versionId: form.versionId, reason: "honeypot" });
    logResult(form.id, "rejected_honeypot");
    return {
      status: 200,
      body: { ok: true, submission_id: ports.newId(), success: successBody(form, "", {}, {}) },
    };
  }

  // 6. Turnstile, en el servidor.
  const secret = await ports.turnstileSecret(form.workspaceId);
  if (!secret) {
    logResult(form.id, "captcha_not_configured");
    return fail(503, "captcha_unavailable", { message: "El formulario no está disponible por ahora. Probá de nuevo en un momento." });
  }
  const captcha = await ports.verifyTurnstile({
    secret,
    token: payload.turnstile_token,
    ip: input.ip,
    idempotencyKey: payload.idempotency_key,
  });
  if (!captcha.ok) {
    if (captcha.codes.includes("network")) {
      logResult(form.id, "captcha_network");
      return fail(503, "captcha_unavailable", { message: "Probá de nuevo en un momento." });
    }
    if (captcha.codes.includes("timeout-or-duplicate")) {
      // Carrera: otra pestaña (o el reintento) ya consumió el token. Si la respuesta existe, es esa.
      const winner = await ports.findSubmission(form.id, payload.idempotency_key);
      if (winner) {
        logResult(form.id, "duplicate_after_captcha", winner.id);
        return duplicateOutcome(form, winner);
      }
    }
    await ports.recordRejected({ workspaceId: form.workspaceId, formId: form.id, versionId: form.versionId, reason: "captcha" });
    logResult(form.id, "rejected_captcha");
    return fail(400, "captcha_failed", { message: "No pudimos verificar que sos una persona. Probá de nuevo." });
  }

  // 7 y 8. Validación total contra la versión VIGENTE.
  const versionChanged = payload.version_id !== form.versionId;
  const attribution = buildAttribution(payload, input.cookieHeader);

  const answersIn: Record<string, unknown> = { ...payload.answers };
  for (const field of form.fields) {
    if (field.type !== "hidden" || !field.hidden) continue;
    if (field.hidden.source === "fixed") delete answersIn[field.key]; // lo pone el servidor
    else if (field.hidden.source === "attribution") {
      const value = field.hidden.param ? attribution[field.hidden.param] : undefined;
      if (typeof value === "string" && value) answersIn[field.key] = value;
      else delete answersIn[field.key];
    }
  }

  const filesByKey = new Map<string, UploadedFile[]>();
  for (const file of input.files) {
    const list = filesByKey.get(file.fieldKey) ?? [];
    list.push(file);
    filesByKey.set(file.fieldKey, list);
  }
  const fileCounts: Record<string, number> = {};
  for (const [key, list] of filesByKey) fileCounts[key] = list.length;

  const defaultCountry =
    countryFromTimezone(payload.client_meta?.timezone) ?? countryFromTimezone(form.workspaceTimezone) ?? null;

  const result = validateSubmission(form.fields, answersIn, { defaultCountry, fileCounts });
  const errors: Record<string, string> = { ...result.errors };

  // 9. Archivos, por su tipo real.
  const visible = new Set(result.visible);
  const stored: Record<string, Array<{ path: string; name: string; size: number; mime: string }>> = {};
  const uploadPrefix = `${form.workspaceId}/${form.id}/${payload.idempotency_key}`;
  const pendingUploads: Array<{ path: string; bytes: Uint8Array; mime: string }> = [];

  for (const field of form.fields) {
    if (field.type !== "file" || !visible.has(field.key) || !field.file) continue;
    const list = filesByKey.get(field.key) ?? [];
    if (list.length === 0) continue;
    if (list.length > field.file.maxFiles) {
      errors[field.key] = `Podés subir hasta ${field.file.maxFiles} archivo${field.file.maxFiles === 1 ? "" : "s"}`;
      continue;
    }
    const kept: Array<{ path: string; name: string; size: number; mime: string }> = [];
    for (const file of list) {
      if (file.bytes.byteLength > field.file.maxMb * 1024 * 1024) {
        errors[field.key] = `El archivo pesa más de ${field.file.maxMb} MB`;
        break;
      }
      const real = sniffUploadMime(file.bytes, file.declaredType);
      if (!real || !field.file.accept.includes(real)) {
        errors[field.key] = "Ese tipo de archivo no está permitido";
        break;
      }
      const ext = EXT_BY_MIME[real] ?? "bin";
      const path = `${uploadPrefix}/${field.key}/${ports.newId()}.${ext}`;
      pendingUploads.push({ path, bytes: file.bytes, mime: real });
      kept.push({ path, name: safeFileName(file.name), size: file.bytes.byteLength, mime: real });
    }
    if (!errors[field.key]) stored[field.key] = kept;
  }

  if (Object.keys(errors).length > 0) {
    if (versionChanged) {
      return fail(409, "form_changed", { message: "El formulario cambió: recargá la página." });
    }
    return fail(400, "invalid", { fields: errors, message: "Revisá los campos marcados." });
  }

  // Recién acá se sube nada: un envío inválido no deja archivos sueltos.
  for (const upload of pendingUploads) {
    const ok = await ports.upload(upload.path, upload.bytes, upload.mime);
    if (!ok) {
      logResult(form.id, "upload_failed");
      return fail(500, "upload_failed", { message: "No pudimos guardar el archivo. Probá de nuevo." });
    }
  }

  // 10. Ocultos `fixed`.
  const values: Record<string, NormalizedValue | unknown> = { ...result.values };
  for (const field of form.fields) {
    if (field.type === "hidden" && field.hidden?.source === "fixed" && field.hidden.value && visible.has(field.key)) {
      values[field.key] = field.hidden.value;
    }
  }
  for (const [key, list] of Object.entries(stored)) values[key] = list;

  // 11. Guardar.
  const saved = await ports.save({
    form,
    idempotencyKey: payload.idempotency_key,
    answers: toLabeledAnswers(form.fields, values),
    attribution,
    meta: buildMeta(ports, input, payload),
    uploadPrefix: pendingUploads.length > 0 ? uploadPrefix : null,
  });

  if (!saved.ok) {
    if (saved.error === "already_answered") return fail(409, "already_answered", { message: "Ya respondiste, ¡gracias!" });
    logResult(form.id, "save_failed");
    return fail(500, "server_error", { message: "No pudimos guardar tu respuesta. Probá de nuevo." });
  }

  // 12. Responder.
  logResult(form.id, saved.duplicate ? "duplicate" : "saved", saved.submissionId);
  return {
    status: 200,
    body: {
      ok: true,
      duplicate: saved.duplicate,
      submission_id: saved.submissionId,
      success: successBody(form, saved.submissionId, values, attribution),
    },
  };
}

// ── Piezas ───────────────────────────────────────────────────────────────────

/** La atribución de la visita, vuelta a sanear: el navegador no es de fiar. */
export function buildAttribution(payload: SubmitPayload, cookieHeader: string | null): Record<string, unknown> {
  const attribution = sanitizeAttribution(payload.attribution) as Record<string, unknown>;
  // Las cookies de anuncios del mismo dominio llegan solas en el pedido.
  const cookies = parseCookieHeader(cookieHeader);
  const fromCookies: Record<string, string | undefined> = {
    [COOKIE_KEYS._fbp]: cookies["_fbp"],
    [COOKIE_KEYS._fbc]: cookies["_fbc"],
  };
  for (const [key, value] of Object.entries(fromCookies)) {
    if (value && !attribution[key]) attribution[key] = value.slice(0, 200);
  }
  return attribution;
}

function buildMeta(ports: SubmitPorts, input: SubmitInput, payload: SubmitPayload): Record<string, unknown> {
  const origin = payload.origin ?? "public_page";
  return {
    ip_hash: ports.hashIp(input.ip),
    user_agent: input.userAgent ? input.userAgent.slice(0, 300) : null,
    origin,
    ...(origin === "site" && payload.site_path ? { site_path: payload.site_path } : {}),
    timezone: payload.client_meta?.timezone ?? null,
    locale: payload.client_meta?.locale ?? null,
  };
}
