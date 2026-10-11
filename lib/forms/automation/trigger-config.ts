/**
 * La configuración de los triggers de Formularios (F19), validada con Zod, y la
 * lógica pura del panel del constructor de flujos. Sin React ni base.
 */
import { z } from "zod";
import { CONDITION_OPERATORS, type VisibilityConfig } from "@/lib/forms/visibility-types";
import type { FormField } from "@/lib/forms/fields";
import { SURVEY_CATEGORIES } from "@/lib/forms/survey-categories";

const conditionSchema = z.object({
  id: z.string().optional(),
  fieldKey: z.string().min(1).max(60),
  operator: z.enum(CONDITION_OPERATORS),
  value: z.string().max(500).default(""),
});

const visibilitySchema = z.object({
  rootConjunction: z.enum(["and", "or"]),
  conditions: z.array(conditionSchema).max(30),
  groups: z.array(z.object({ id: z.string().optional(), conjunction: z.enum(["and", "or"]), conditions: z.array(conditionSchema).max(30) })).max(10),
});

const NPS = ["promoter", "passive", "detractor"] as const;

const baseSchema = z.object({
  form_ids: z.array(z.string().uuid()).max(100).default([]),
  answer_conditions: visibilitySchema.nullish(),
});

const surveySchema = baseSchema.extend({
  score: z.object({ operator: z.enum(["lte", "gte", "eq"]), value: z.number().finite() }).nullish(),
  nps_categories: z.array(z.enum(NPS)).max(3).nullish(),
  survey_categories: z.array(z.enum(SURVEY_CATEGORIES)).max(10).nullish(),
});

const contractSchema = z.object({ form_ids: z.array(z.string().uuid()).max(100).default([]) });

export interface FormTriggerConfig {
  form_ids: string[];
  answer_conditions?: VisibilityConfig | null;
  score?: { operator: "lte" | "gte" | "eq"; value: number } | null;
  nps_categories?: Array<(typeof NPS)[number]> | null;
  survey_categories?: string[] | null;
}

export type ParsedTriggerConfig = { ok: true; config: FormTriggerConfig } | { ok: false; error: string };

export function parseFormTriggerConfig(type: string, raw: unknown): ParsedTriggerConfig {
  const input = raw && typeof raw === "object" ? raw : {};
  const schema = type === "survey_answered" ? surveySchema : type === "contract_signed" ? contractSchema : baseSchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "La configuración del trigger no es válida" };
  return { ok: true, config: parsed.data as FormTriggerConfig };
}

/**
 * La configuración limpia para guardar: sin listas vacías ni condiciones sin
 * renglones (vacío = cualquiera, y se guarda como ausencia).
 */
export function cleanTriggerConfig(type: string, raw: unknown): FormTriggerConfig {
  const parsed = parseFormTriggerConfig(type, raw);
  const config: FormTriggerConfig = parsed.ok ? { ...parsed.config } : { form_ids: [] };
  config.form_ids = [...new Set(config.form_ids)];

  const vis = config.answer_conditions;
  if (!vis || (vis.conditions.length === 0 && vis.groups.every((g) => g.conditions.length === 0))) delete config.answer_conditions;
  if (type === "contract_signed") {
    delete config.answer_conditions;
    delete config.score;
    delete config.nps_categories;
    delete config.survey_categories;
    return config;
  }
  if (type !== "survey_answered") {
    delete config.score;
    delete config.nps_categories;
    delete config.survey_categories;
    return config;
  }
  if (!config.nps_categories || config.nps_categories.length === 0) delete config.nps_categories;
  if (!config.survey_categories || config.survey_categories.length === 0) delete config.survey_categories;
  if (!config.score) delete config.score;
  return config;
}

export interface FormWithFields {
  id: string;
  fields: FormField[];
}

/**
 * Los campos sobre los que se puede armar una condición: con un solo formulario,
 * los suyos; con varios, solo los que tienen la misma clave y el mismo tipo en
 * TODOS (si no, la condición querría decir cosas distintas según el formulario).
 */
export function commonFields(forms: FormWithFields[]): FormField[] {
  if (forms.length === 0) return [];
  const [first, ...rest] = forms;
  return first.fields.filter((field) => field.type !== "hidden" && field.type !== "file" && rest.every((form) => form.fields.some((f) => f.key === field.key && f.type === field.type)));
}

const NPS_LABELS: Record<(typeof NPS)[number], string> = { promoter: "promotores", passive: "pasivos", detractor: "detractores" };
const SCORE_WORDS: Record<"lte" | "gte" | "eq", string> = { lte: "menor o igual a", gte: "mayor o igual a", eq: "igual a" };

/** El trigger en palabras, para la lista de automatizaciones del formulario. */
export function describeFormTrigger(type: string, rawConfig: unknown, formNames: Record<string, string> = {}): string {
  const parsed = parseFormTriggerConfig(type, rawConfig);
  const label = type === "survey_answered" ? "Se responde una encuesta" : type === "contract_signed" ? "Se firma un contrato" : "Se envía un formulario";
  if (!parsed.ok) return `${label} (configuración inválida)`;
  const c = parsed.config;
  const parts: string[] = [];
  if (c.form_ids.length > 0) parts.push(`en ${c.form_ids.map((id) => `«${formNames[id] ?? "formulario"}»`).join(" o ")}`);
  else parts.push("en cualquier formulario");
  if (c.nps_categories?.length) parts.push(`de ${c.nps_categories.map((n) => NPS_LABELS[n]).join(" o ")}`);
  if (c.score) parts.push(`con puntaje ${SCORE_WORDS[c.score.operator]} ${c.score.value}`);
  if (c.survey_categories?.length) parts.push(`de la categoría ${c.survey_categories.join(" o ")}`);
  const hasConditions = !!c.answer_conditions && (c.answer_conditions.conditions.length > 0 || c.answer_conditions.groups.some((g) => g.conditions.length > 0));
  if (hasConditions) parts.push("si cumple las condiciones");
  return `${label} ${parts.join(", ")}`;
}
