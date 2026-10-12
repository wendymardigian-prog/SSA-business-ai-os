/**
 * Enviar un reporte de fin de día (E8), y guardar su borrador (E7), del lado del servidor.
 *
 * Todo se valida acá, contra la versión vigente del reporte, con la MISMA validación de
 * Formularios (`validateSubmission`). La persona que reporta es la de la sesión: llega
 * como `userId` desde la acción, nunca del navegador.
 *
 * Los accesos a la base van por puertos (`EodPorts`): las Server Actions pasan los reales
 * (`lib/eod/server-ports.ts`) y los tests, unos simulados.
 */
import { todayInputValue } from "@/lib/dates";
import { toLabeledAnswers, validateSubmission, type LabeledAnswer } from "@/lib/forms/submission-schema";
import type { FormField } from "@/lib/forms/fields";
import { isInAudience, type AudienceMember } from "./audience";
import type { EodConfig } from "./config";
import { REPORT_DATE_MESSAGES, reportDateProblem, shortDate } from "./dates";
import { computeEodMetrics, type EodMetrics } from "./metrics";
import { parseDraftData } from "./draft-shape";
import type { EodDraftData, ServerDraft } from "./draft";
import type { EodChannel, EodChannelSelector } from "./types";

// ── Lo que el servidor necesita saber ────────────────────────────────────────

export interface EodVersion {
  id: string;
  number: number;
  fields: FormField[];
  channelSelector: EodChannelSelector | null;
  channels: EodChannel[];
}

export interface EodFormContext {
  id: string;
  workspaceId: string;
  name: string;
  status: string;
  config: EodConfig;
  version: EodVersion | null;
}

export interface EodReportState {
  id: string;
  status: "draft" | "submitted";
  rev: number;
  savedAt: string | null;
  /** El borrador vigente: el de la fila, o `pending_edit` si se está corrigiendo uno enviado. */
  draft: EodDraftData;
  /** Lo enviado (formato con etiqueta), para el historial de una corrección. */
  submitted: { answers: Record<string, LabeledAnswer>; channels: SubmittedChannels } | null;
  editCount: number;
}

export type SubmittedChannels = Record<string, { label: string; answers: Record<string, LabeledAnswer> }>;

export interface EodPorts {
  loadForm(formId: string): Promise<EodFormContext | null>;
  loadMember(workspaceId: string, userId: string): Promise<(AudienceMember & { name: string }) | null>;
  /** La zona horaria de la persona (user_preferences), o la del workspace. */
  timezoneOf(userId: string, workspaceId: string): Promise<string>;
  loadReport(formId: string, userId: string, reportDate: string): Promise<EodReportState | null>;
  saveDraft(args: {
    workspaceId: string;
    formId: string;
    userId: string;
    reportDate: string;
    rev: number;
    data: EodDraftData;
    reportMode: EodConfig["reportMode"];
  }): Promise<SaveRpcResult>;
  submit(args: {
    workspaceId: string;
    formId: string;
    userId: string;
    reportDate: string;
    rev: number;
    versionId: string;
    answers: Record<string, LabeledAnswer>;
    channels: SubmittedChannels;
    metrics: EodMetrics;
    reportMode: EodConfig["reportMode"];
    auditChanges: Record<string, unknown> | null;
  }): Promise<SubmitRpcResult>;
  /** Después del commit. Nunca lanza (lo envuelve quien llama igual). */
  notify(args: { form: EodFormContext; reportId: string; reporterName: string; reportDate: string; edited: boolean }): Promise<void>;
  now(): Date;
}

export type SaveRpcResult =
  | { ok: true; rev: number; savedAt: string; status: "draft" | "submitted" }
  | { ok: false; error: "conflict"; current: ServerDraft & { status: "draft" | "submitted" } }
  | { ok: false; error: "already_submitted" | "failed" };

export type SubmitRpcResult =
  | { ok: true; reportId: string; first: boolean; editCount: number; rev: number }
  | { ok: false; error: "conflict" | "already_submitted" | "failed" };

// ── Acceso: publicado, audiencia y fecha ─────────────────────────────────────

export const NOT_AVAILABLE = "Este reporte no está disponible para vos";

export type AccessResult =
  | { ok: true; form: EodFormContext & { version: EodVersion }; member: AudienceMember & { name: string }; today: string; timeZone: string }
  | { ok: false; error: string; code: "not_available" | "date" };

/** Lo que se comprueba antes de leer o escribir un reporte, en el orden de E8. */
export async function checkAccess(ports: EodPorts, input: { workspaceId: string; userId: string; formId: string; reportDate: unknown }): Promise<AccessResult> {
  const form = await ports.loadForm(input.formId);
  if (!form || form.workspaceId !== input.workspaceId) return { ok: false, error: NOT_AVAILABLE, code: "not_available" };
  const member = await ports.loadMember(input.workspaceId, input.userId);
  if (!member || !isInAudience(form.config, member)) return { ok: false, error: NOT_AVAILABLE, code: "not_available" };
  if (form.status !== "published" || !form.version) return { ok: false, error: NOT_AVAILABLE, code: "not_available" };
  const timeZone = await ports.timezoneOf(input.userId, input.workspaceId);
  const today = todayInputValue(ports.now(), timeZone);
  const problem = reportDateProblem(input.reportDate, today, form.config.pastDays);
  if (problem) return { ok: false, error: REPORT_DATE_MESSAGES[problem], code: "date" };
  return { ok: true, form: form as EodFormContext & { version: EodVersion }, member, today, timeZone };
}

// ── Guardar el borrador ──────────────────────────────────────────────────────

export type SaveDraftResult =
  | { ok: true; rev: number; savedAt: string }
  | { ok: false; error: string; code: "not_available" | "date" | "invalid" | "already_submitted" | "failed" }
  | { ok: false; error: string; code: "conflict"; current: ServerDraft };

export async function saveDraftCore(
  ports: EodPorts,
  input: { workspaceId: string; userId: string; formId: string; reportDate: unknown; rev: unknown; data: unknown },
): Promise<SaveDraftResult> {
  const data = parseDraftData(input.data);
  if (!data || typeof input.rev !== "number" || !Number.isInteger(input.rev) || input.rev < 0) {
    return { ok: false, error: "El borrador no tiene una forma válida", code: "invalid" };
  }
  const access = await checkAccess(ports, input);
  if (!access.ok) return access;

  const result = await ports.saveDraft({
    workspaceId: input.workspaceId,
    formId: input.formId,
    userId: input.userId,
    reportDate: input.reportDate as string,
    rev: input.rev,
    data,
    reportMode: access.form.config.reportMode,
  });
  if (result.ok) return { ok: true, rev: result.rev, savedAt: result.savedAt };
  if (result.error === "conflict") {
    return { ok: false, error: "Se actualizó con lo que cargaste en otra pestaña", code: "conflict", current: result.current };
  }
  if (result.error === "already_submitted") return { ok: false, error: ALREADY_SUBMITTED, code: "already_submitted" };
  return { ok: false, error: "No se pudo guardar. Reintentá.", code: "failed" };
}

// ── Validar lo que se envía ──────────────────────────────────────────────────

export const ALREADY_SUBMITTED = "Ya enviaste el reporte de este día";

export interface ValidatedReport {
  answers: Record<string, LabeledAnswer>;
  channels: SubmittedChannels;
  metrics: EodMetrics;
  /** Lo del borrador que ya no está en el reporte (por clave): se descarta con un aviso. */
  discarded: string[];
}

function stepProblem(field: FormField, value: unknown): string | null {
  if (field.type !== "number" || typeof value !== "number") return null;
  if (!Number.isInteger(value)) return "Tiene que ser un número entero";
  const step = field.step && field.step > 1 ? field.step : 1;
  if (step > 1 && (value - (field.min ?? 0)) % step !== 0) return `Tiene que ir de ${step} en ${step}`;
  return null;
}

function validateGroup(fields: FormField[], raw: Record<string, unknown>, where: string, errors: string[]): Record<string, LabeledAnswer> {
  const result = validateSubmission(fields, raw);
  for (const field of fields) {
    const problem = result.errors[field.key] ?? stepProblem(field, result.values[field.key]);
    if (problem) errors.push(`${where}"${field.label}": ${problem}`);
  }
  return toLabeledAnswers(fields, result.values);
}

/**
 * La validación total contra la versión vigente: las preguntas generales siempre; las de
 * cada canal, solo de los canales elegidos (y activos en esta versión); el selector, si es
 * obligatorio. Lo que se cargó en un canal apagado no se guarda ni suma.
 */
export function validateEodReport(version: EodVersion, draft: EodDraftData): { ok: true; report: ValidatedReport } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const discarded: string[] = [];

  const known = new Set(version.fields.map((f) => f.key));
  for (const key of Object.keys(draft.answers)) if (!known.has(key)) discarded.push(key);
  const answers = validateGroup(version.fields, draft.answers, "", errors);

  const channels: SubmittedChannels = {};
  const channelAnswers: Record<string, Record<string, unknown>> = {};
  const selectedKeys: string[] = [];
  const hasChannels = version.channelSelector !== null;
  if (hasChannels) {
    const active = version.channels.filter((c) => c.enabled);
    for (const channel of active) {
      if (!draft.channels[channel.key]?.selected) continue;
      selectedKeys.push(channel.key);
      const raw = draft.channels[channel.key].answers;
      const knownInChannel = new Set(channel.fields.map((f) => f.key));
      for (const key of Object.keys(raw)) if (!knownInChannel.has(key)) discarded.push(`${channel.key}.${key}`);
      channels[channel.key] = { label: channel.label, answers: validateGroup(channel.fields, raw, `Canal "${channel.label}": `, errors) };
      channelAnswers[channel.key] = Object.fromEntries(Object.entries(channels[channel.key].answers).map(([k, a]) => [k, a.value]));
    }
    for (const [key, value] of Object.entries(draft.channels)) {
      if (value.selected && !active.some((c) => c.key === key)) discarded.push(key);
    }
    if (version.channelSelector?.required && selectedKeys.length === 0) {
      errors.unshift(`Elegí al menos un canal ("${version.channelSelector.label}")`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const metrics = computeEodMetrics({
    generalFields: version.fields,
    generalAnswers: Object.fromEntries(Object.entries(answers).map(([k, a]) => [k, a.value])),
    channels: version.channels,
    channelAnswers,
    selectedKeys,
  });
  return { ok: true, report: { answers, channels, metrics, discarded } };
}

/** Lo que cambió en una corrección, para el historial (solo claves con valor distinto). */
export function diffReports(
  before: { answers: Record<string, LabeledAnswer>; channels: SubmittedChannels },
  after: { answers: Record<string, LabeledAnswer>; channels: SubmittedChannels },
): Record<string, { old: unknown; new: unknown }> {
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const key of new Set([...Object.keys(before.answers), ...Object.keys(after.answers)])) {
    const old = before.answers[key]?.value;
    const next = after.answers[key]?.value;
    if (!same(old, next)) changes[key] = { old: old ?? null, new: next ?? null };
  }
  for (const channel of new Set([...Object.keys(before.channels), ...Object.keys(after.channels)])) {
    const b = before.channels[channel]?.answers ?? {};
    const a = after.channels[channel]?.answers ?? {};
    if (!before.channels[channel] || !after.channels[channel]) {
      changes[`canal.${channel}`] = { old: before.channels[channel] ? "elegido" : null, new: after.channels[channel] ? "elegido" : null };
    }
    for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (!same(b[key]?.value, a[key]?.value)) changes[`${channel}.${key}`] = { old: b[key]?.value ?? null, new: a[key]?.value ?? null };
    }
  }
  return changes;
}

// ── Enviar ───────────────────────────────────────────────────────────────────

export type SubmitResult =
  | { ok: true; reportId: string; edited: boolean; discarded: string[] }
  | { ok: false; error: string; code: "not_available" | "date" | "invalid" | "already_submitted" | "conflict" | "failed"; errors?: string[] };

export async function submitEodCore(
  ports: EodPorts,
  input: { workspaceId: string; userId: string; formId: string; reportDate: unknown; rev: unknown },
): Promise<SubmitResult> {
  if (typeof input.rev !== "number" || !Number.isInteger(input.rev) || input.rev < 0) {
    return { ok: false, error: "Los datos no son válidos", code: "invalid" };
  }
  const access = await checkAccess(ports, input);
  if (!access.ok) return access;
  const { form, member } = access;
  const reportDate = input.reportDate as string;

  const report = await ports.loadReport(form.id, input.userId, reportDate);
  if (report?.status === "submitted" && form.config.reportMode === "single") {
    return { ok: false, error: ALREADY_SUBMITTED, code: "already_submitted" };
  }
  if ((report?.rev ?? 0) !== input.rev) {
    return { ok: false, error: "Se actualizó con lo que cargaste en otra pestaña: revisalo y volvé a enviar", code: "conflict" };
  }

  const validated = validateEodReport(form.version, report?.draft ?? { answers: {}, channels: {} });
  if (!validated.ok) return { ok: false, error: validated.errors[0], code: "invalid", errors: validated.errors };

  const edited = report?.status === "submitted";
  const auditChanges = edited && report?.submitted ? diffReports(report.submitted, validated.report) : null;

  const result = await ports.submit({
    workspaceId: form.workspaceId,
    formId: form.id,
    userId: input.userId,
    reportDate,
    rev: input.rev,
    versionId: form.version.id,
    answers: validated.report.answers,
    channels: validated.report.channels,
    metrics: validated.report.metrics,
    reportMode: form.config.reportMode,
    auditChanges,
  });
  if (!result.ok) {
    if (result.error === "already_submitted") return { ok: false, error: ALREADY_SUBMITTED, code: "already_submitted" };
    if (result.error === "conflict") return { ok: false, error: "Se actualizó con lo que cargaste en otra pestaña: revisalo y volvé a enviar", code: "conflict" };
    return { ok: false, error: "No se pudo enviar el reporte. Probá de nuevo.", code: "failed" };
  }

  // Después del commit: el aviso nunca tumba el envío.
  try {
    await ports.notify({ form, reportId: result.reportId, reporterName: member.name, reportDate, edited: !result.first });
  } catch (error) {
    console.error("[eod] no pude avisar el envío:", error instanceof Error ? error.message : "error");
  }
  return { ok: true, reportId: result.reportId, edited: !result.first, discarded: validated.report.discarded };
}

/** "Ana envió su reporte del 12/10" / "Ana corrigió su reporte del 12/10". */
export function notificationTitle(reporterName: string, reportDate: string, edited: boolean): string {
  return `${reporterName} ${edited ? "corrigió" : "envió"} su reporte del ${shortDate(reportDate)}`;
}
