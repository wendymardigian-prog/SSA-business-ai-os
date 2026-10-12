/**
 * Qué mide cada pregunta numérica de un EOD (`metricKey`) y los totales del día.
 *
 * Dos preguntas con la misma `metricKey` en canales distintos se SUMAN en el total:
 * así sale "links enviados en total, sumando todos los canales". Puro.
 */
import type { FormField } from "@/lib/forms/fields";
import type { EodChannel } from "./types";

export const EOD_METRICS = [
  { key: "conv_inbound", label: "Conversaciones nuevas inbound" },
  { key: "conv_outbound", label: "Conversaciones nuevas outbound" },
  { key: "seguimientos", label: "Seguimientos" },
  { key: "respuestas", label: "Respuestas" },
  { key: "links_enviados", label: "Links enviados" },
  { key: "llamadas_agendadas", label: "Llamadas agendadas" },
  { key: "horas_trabajadas", label: "Horas trabajadas" },
  { key: "rendimiento", label: "Rendimiento" },
] as const;

export type EodMetricKey = (typeof EOD_METRICS)[number]["key"];

/** Una clave propia ("Otra"): minúsculas, números y guión bajo, de 2 a 40. */
export const CUSTOM_METRIC_RE = /^[a-z0-9_]{2,40}$/;

export function isCatalogMetric(key: string): key is EodMetricKey {
  return EOD_METRICS.some((m) => m.key === key);
}

export function isValidMetricKey(key: string): boolean {
  return isCatalogMetric(key) || CUSTOM_METRIC_RE.test(key);
}

/** La etiqueta de una métrica: la del catálogo, o la clave tal cual si es propia. */
export function metricLabel(key: string): string {
  return EOD_METRICS.find((m) => m.key === key)?.label ?? key;
}

/** `{ total: { links_enviados: 12 }, instagram: { links_enviados: 5 }, … }` */
export type EodMetrics = Record<string, Record<string, number>>;

export const GENERAL_SCOPE = "general";
export const TOTAL_SCOPE = "total";

function addNumber(target: Record<string, number>, key: string, value: number): void {
  target[key] = (target[key] ?? 0) + value;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/**
 * Los totales por `metricKey`: por canal, de las preguntas generales y en total.
 * Solo cuenta los canales de `selectedKeys`: lo cargado en un canal apagado no suma.
 * Un valor que no es número (vacío, texto) no suma: nunca se inventa un cero.
 */
export function computeEodMetrics(input: {
  generalFields: FormField[];
  generalAnswers: Record<string, unknown>;
  channels: EodChannel[];
  channelAnswers: Record<string, Record<string, unknown>>;
  selectedKeys: string[];
}): EodMetrics {
  const result: EodMetrics = { [TOTAL_SCOPE]: {} };
  const total = result[TOTAL_SCOPE];

  for (const field of input.generalFields) {
    if (field.type !== "number" || !field.metricKey) continue;
    const value = numericValue(input.generalAnswers[field.key]);
    if (value === null) continue;
    result[GENERAL_SCOPE] ??= {};
    addNumber(result[GENERAL_SCOPE], field.metricKey, value);
    addNumber(total, field.metricKey, value);
  }

  const selected = new Set(input.selectedKeys);
  for (const channel of input.channels) {
    if (!selected.has(channel.key)) continue;
    const answers = input.channelAnswers[channel.key] ?? {};
    for (const field of channel.fields) {
      if (field.type !== "number" || !field.metricKey) continue;
      const value = numericValue(answers[field.key]);
      if (value === null) continue;
      result[channel.key] ??= {};
      addNumber(result[channel.key], field.metricKey, value);
      addNumber(total, field.metricKey, value);
    }
  }

  return result;
}

/** Las `metricKey` que usa una definición, en orden de aparición y sin repetir. */
export function metricKeysOf(generalFields: FormField[], channels: EodChannel[]): string[] {
  const keys: string[] = [];
  const push = (field: FormField) => {
    if (field.type === "number" && field.metricKey && !keys.includes(field.metricKey)) keys.push(field.metricKey);
  };
  generalFields.forEach(push);
  for (const channel of channels) channel.fields.forEach(push);
  return keys;
}
