/**
 * Las variables de un reporte de fin de día en un flujo (E16), y qué se puede comparar en
 * "Condiciones". PURO.
 *
 *   {{member.name}} {{member.email}}             quien envió
 *   {{eod.date}} {{eod.role}} {{eod.channels}}   el día, el rol y los canales elegidos
 *   {{eod.all_answers}}                          todas las respuestas, una por línea (para un email)
 *   {{answer.<clave>}}                           una pregunta general
 *   {{channel.<canal>.<clave>}}                  una pregunta de un canal
 *   {{metrics.total.<métrica>}}                  el total de una métrica sumando canales
 *   {{metrics.<canal>.<métrica>}}                la métrica de un canal
 *   {{report.url}}                               el link al reporte (pide sesión)
 *
 * Todo texto (las condiciones convierten los números al comparar). Un dato que falta queda
 * vacío. Las claves con guion pasan a guion bajo, igual que en Formularios.
 */
import type { ConditionFieldSpec } from "@/lib/flow-engine/condition-eval";
import { conditionTypeOfField } from "@/lib/forms/automation/variable-schema";
import { variableKey } from "@/lib/forms/automation/variables";
import { answerToText } from "@/lib/forms/responses";
import type { LabeledAnswer } from "@/lib/forms/submission-schema";
import type { FormField } from "@/lib/forms/fields";
import { EOD_METRICS, metricKeysOf, metricLabel, TOTAL_SCOPE, type EodMetrics } from "../metrics";
import type { EodChannel } from "../types";

export interface EodVariablesInput {
  form: { id: string; name: string; roleLabel: string };
  report: {
    id: string;
    reportDate: string;
    editCount: number;
    answers: Record<string, LabeledAnswer>;
    channels: Record<string, { label: string; answers: Record<string, LabeledAnswer> }>;
    metrics: EodMetrics;
  };
  member: { name: string; email: string };
  baseUrl: string;
}

export function reportUrl(baseUrl: string, formId: string, reportId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/dashboard/formularios/${formId}/reportes/${reportId}`;
}

/** Todas las respuestas, una por línea: primero las generales, después cada canal. */
export function allAnswersText(report: EodVariablesInput["report"]): string {
  const lines: string[] = [];
  for (const answer of Object.values(report.answers)) lines.push(`${answer.label}: ${answerToText(answer.value) || "—"}`);
  for (const channel of Object.values(report.channels)) {
    lines.push("", channel.label);
    for (const answer of Object.values(channel.answers)) lines.push(`${answer.label}: ${answerToText(answer.value) || "—"}`);
  }
  return lines.join("\n").trim();
}

export function eodVariables(input: EodVariablesInput): Record<string, unknown> {
  const { report } = input;
  const answer: Record<string, string> = {};
  for (const [key, a] of Object.entries(report.answers)) answer[variableKey(key)] = answerToText(a.value);
  const channel: Record<string, Record<string, string>> = {};
  for (const [key, c] of Object.entries(report.channels)) {
    channel[variableKey(key)] = Object.fromEntries(Object.entries(c.answers).map(([k, a]) => [variableKey(k), answerToText(a.value)]));
  }
  const metrics: Record<string, Record<string, string>> = {};
  for (const [scope, values] of Object.entries(report.metrics ?? {})) {
    if (scope === "general") continue;
    metrics[variableKey(scope)] = Object.fromEntries(Object.entries(values).map(([k, n]) => [variableKey(k), String(n)]));
  }
  metrics[TOTAL_SCOPE] ??= {};
  return {
    member: { name: input.member.name, email: input.member.email },
    eod: {
      date: report.reportDate,
      role: input.form.roleLabel,
      channels: Object.values(report.channels).map((c) => c.label).join(", "),
      all_answers: allAnswersText(report),
      form_name: input.form.name,
      edit_count: String(report.editCount),
    },
    answer,
    channel,
    metrics,
    report: { id: report.id, form_id: input.form.id, url: reportUrl(input.baseUrl, input.form.id, report.id) },
  };
}

// ── Qué se puede comparar ────────────────────────────────────────────────────

export const EOD_GROUP = "Del reporte";
export const METRICS_GROUP = "Métricas del reporte";

export interface EodFormForSchema {
  id: string;
  fields: FormField[];
  channels: EodChannel[];
}

function questionSpec(path: string, field: FormField, prefix = ""): ConditionFieldSpec {
  const type = conditionTypeOfField(field.type);
  return {
    path,
    label: `${prefix}${field.label || field.key}`,
    type,
    ...(type === "single_select" || type === "multi_select" ? { options: (field.options ?? []).map((o) => ({ value: o, label: o })) } : {}),
    group: EOD_GROUP,
  };
}

/** Solo lo que significa lo mismo en TODOS los reportes elegidos (misma ruta, mismo tipo). */
function common(lists: ConditionFieldSpec[][]): ConditionFieldSpec[] {
  if (lists.length === 0) return [];
  const [first, ...rest] = lists;
  return first.filter((spec) => rest.every((list) => list.some((s) => s.path === spec.path && s.type === spec.type)));
}

/**
 * Los campos para "Condiciones" de un disparador de EOD. Sin reportes elegidos ("cualquiera"),
 * solo lo que tiene cualquier EOD: quién, el día, el rol y el total de cada métrica del catálogo.
 */
export function eodVariableSchema(forms: EodFormForSchema[]): ConditionFieldSpec[] {
  const base: ConditionFieldSpec[] = [
    { path: "member.name", label: "Quién lo envió", type: "text", group: EOD_GROUP },
    { path: "eod.date", label: "Día del reporte", type: "date", group: EOD_GROUP },
    { path: "eod.role", label: "Rol del reporte", type: "text", group: EOD_GROUP },
  ];
  if (forms.length === 0) {
    return [
      ...base,
      ...EOD_METRICS.map((m): ConditionFieldSpec => ({ path: `metrics.total.${m.key}`, label: `${m.label} (total)`, type: "number", group: METRICS_GROUP })),
    ];
  }

  const perForm = forms.map((form) => {
    const active = form.channels.filter((c) => c.enabled);
    const specs: ConditionFieldSpec[] = [];
    if (active.length > 0) {
      specs.push({ path: "eod.channels", label: "Canales que trabajó", type: "multi_select", options: active.map((c) => ({ value: c.label, label: c.label })), group: EOD_GROUP });
    }
    for (const field of form.fields) specs.push(questionSpec(`answer.${variableKey(field.key)}`, field));
    for (const channel of active) {
      for (const field of channel.fields) specs.push(questionSpec(`channel.${variableKey(channel.key)}.${variableKey(field.key)}`, field, `${channel.label} · `));
    }
    for (const key of metricKeysOf(form.fields, active)) {
      specs.push({ path: `metrics.total.${variableKey(key)}`, label: `${metricLabel(key)} (total)`, type: "number", group: METRICS_GROUP });
      for (const channel of active) {
        if (channel.fields.some((f) => f.type === "number" && f.metricKey === key)) {
          specs.push({ path: `metrics.${variableKey(channel.key)}.${variableKey(key)}`, label: `${metricLabel(key)} · ${channel.label}`, type: "number", group: METRICS_GROUP });
        }
      }
    }
    return specs;
  });
  return [...base, ...common(perForm)];
}

/**
 * Las variables como rutas planas (`metrics.total.links_enviados` → "4"), para "Probar
 * condiciones" con un reporte real. Una lista de textos queda como texto separado por comas.
 */
export function flattenVariables(vars: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) Object.assign(out, flattenVariables(value as Record<string, unknown>, path));
    else if (value !== null && value !== undefined) out[path] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}
