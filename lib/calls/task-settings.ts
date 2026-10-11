/**
 * La configuracion de las tareas Clasificacion y Analisis de llamadas (F19).
 *
 * NO hay tabla propia: vive en `workspaces.ai_background_settings`, bajo las
 * claves `call_classification` y `call_analysis`, con su propio esquema Zod
 * (separado del de las tareas por lote, que no se toca). Lo guarda
 * `saveCallTaskSettings` con `set_ai_background_task_settings` (00148), que
 * solo escribe UNA clave. Aca: forma, valores por defecto, lectura tolerante y
 * validacion estricta. Puro.
 */

import { z } from "zod";
import { BASE_CALL_TYPES } from "./classification";
import {
  DEFAULT_RUBRIC, EMPTY_CATEGORIES, normalizeCategories, normalizeRubric, rubricScoringChanged, slugKey,
  validateRubric, type CallCategories, type Rubric,
} from "./rubric";

export const CALL_TASK_KEYS = ["call_classification", "call_analysis"] as const;
export type CallTaskKey = (typeof CALL_TASK_KEYS)[number];

export function isCallTaskKey(value: unknown): value is CallTaskKey {
  return typeof value === "string" && (CALL_TASK_KEYS as readonly string[]).includes(value);
}

// ── Clasificacion ─────────────────────────────────────────────────────────

export const RULE_CONDITIONS = ["duration_lt", "people_gte", "title_contains", "email_contains", "only_team", "has_appointment"] as const;
export type RuleCondition = (typeof RULE_CONDITIONS)[number];

export interface ClassificationRuleSetting {
  id: string;
  on: boolean;
  cond: RuleCondition;
  value?: number | string[] | null;
  type: string;
}

export interface CustomCallType {
  clave: string;
  nombre: string;
  descripcion: string;
  archivado: boolean;
}

export interface CallClassificationSettings {
  /** `now` = con IA; `off` = solo reglas (lo que no deciden queda "por revisar"). */
  mode: "now" | "off";
  rules: ClassificationRuleSetting[];
  confidence_threshold: number;
  custom_types: CustomCallType[];
  allow_ai_types: boolean;
  discarded_types: string[];
  /** Compatibilidad con `TaskConfig`: el modelo real es `ai_task_models`. */
  model: string | null;
}

export const DEFAULT_RULES: ClassificationRuleSetting[] = [
  { id: "r-no-show", on: true, cond: "duration_lt", value: 10, type: "no_show" },
  { id: "r-muchos", on: true, cond: "people_gte", value: 4, type: "equipo" },
  { id: "r-titulo", on: true, cond: "title_contains", value: [], type: "equipo" },
  { id: "r-equipo", on: true, cond: "only_team", value: null, type: "equipo" },
  { id: "r-agenda", on: true, cond: "has_appointment", value: null, type: "cierre" },
];

export const DEFAULT_CLASSIFICATION: CallClassificationSettings = {
  mode: "now",
  rules: DEFAULT_RULES,
  confidence_threshold: 0.7,
  custom_types: [],
  allow_ai_types: true,
  discarded_types: [],
  model: null,
};

// ── Analisis ──────────────────────────────────────────────────────────────

export const MAX_COMPANY_CONTEXT = 4000;

export interface CallAnalysisSettings {
  /** `now` = automatico; `off` = solo con el boton. Arranca APAGADO: el primer gasto lo decide una persona. */
  mode: "now" | "off";
  analyze_types: string[];
  auto_summary: boolean;
  auto_knowledge: boolean;
  allow_new_categories: boolean;
  company_context: string | null;
  rubric: Rubric;
  categories: CallCategories;
  model: string | null;
}

export const DEFAULT_ANALYSIS: CallAnalysisSettings = {
  mode: "off",
  analyze_types: ["cierre", "seguimiento"],
  auto_summary: true,
  auto_knowledge: false,
  allow_new_categories: true,
  company_context: null,
  rubric: DEFAULT_RUBRIC,
  categories: EMPTY_CATEGORIES,
  model: null,
};

// ── Esquemas Zod ──────────────────────────────────────────────────────────

const ruleSchema = z.object({
  id: z.string().min(1).max(60),
  on: z.boolean(),
  cond: z.enum(RULE_CONDITIONS),
  value: z.union([z.number(), z.array(z.string().max(120)).max(50), z.null()]).optional(),
  type: z.string().min(1).max(40),
});

const customTypeSchema = z.object({
  clave: z.string().regex(/^[a-z0-9_]{1,40}$/, "La clave del tipo solo lleva minúsculas, números y guiones bajos"),
  nombre: z.string().trim().min(1, "El tipo necesita un nombre").max(60),
  descripcion: z.string().max(400),
  archivado: z.boolean(),
});

const classificationSchema = z.object({
  mode: z.enum(["now", "off"]),
  rules: z.array(ruleSchema).max(30),
  confidence_threshold: z.number().min(0).max(1),
  custom_types: z.array(customTypeSchema).max(30),
  allow_ai_types: z.boolean(),
  discarded_types: z.array(z.string().max(60)).max(100),
  model: z.string().nullable(),
});

const analysisSchema = z.object({
  mode: z.enum(["now", "off"]),
  analyze_types: z.array(z.string().min(1).max(40)).max(40),
  auto_summary: z.boolean(),
  auto_knowledge: z.boolean(),
  allow_new_categories: z.boolean(),
  company_context: z.string().max(MAX_COMPANY_CONTEXT, `El contexto del negocio puede tener hasta ${MAX_COMPANY_CONTEXT} caracteres`).nullable(),
  rubric: z.unknown(),
  categories: z.unknown(),
  model: z.string().nullable(),
});

// ── Lectura tolerante ─────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Todos los tipos validos: los base mas los propios no archivados. */
export function validTypeKeys(custom: CustomCallType[]): string[] {
  return [...BASE_CALL_TYPES, ...custom.filter((c) => !c.archivado).map((c) => c.clave)];
}

function readClassification(raw: unknown): CallClassificationSettings {
  if (!isObj(raw)) return structuredClone(DEFAULT_CLASSIFICATION);
  const parsed = classificationSchema.safeParse({ ...DEFAULT_CLASSIFICATION, ...raw });
  return parsed.success ? (parsed.data as CallClassificationSettings) : structuredClone(DEFAULT_CLASSIFICATION);
}

function readAnalysis(raw: unknown): CallAnalysisSettings {
  if (!isObj(raw)) return structuredClone(DEFAULT_ANALYSIS);
  const merged = { ...DEFAULT_ANALYSIS, ...raw };
  const parsed = analysisSchema.safeParse(merged);
  if (!parsed.success) return structuredClone(DEFAULT_ANALYSIS);
  return {
    ...(parsed.data as Omit<CallAnalysisSettings, "rubric" | "categories">),
    rubric: normalizeRubric(raw.rubric ?? DEFAULT_RUBRIC),
    categories: normalizeCategories(raw.categories ?? EMPTY_CATEGORIES),
  };
}

export interface CallTaskSettings {
  call_classification: CallClassificationSettings;
  call_analysis: CallAnalysisSettings;
}

/**
 * Lee las dos claves de `ai_background_settings`. Cada una cae a su default si
 * falta o no valida, SIN afectar a la otra ni a las claves de las demas tareas.
 */
export function resolveCallTaskSettings(raw: unknown): CallTaskSettings {
  const stored = isObj(raw) ? raw : {};
  return {
    call_classification: readClassification(stored.call_classification),
    call_analysis: readAnalysis(stored.call_analysis),
  };
}

// ── Validacion estricta (al guardar) ──────────────────────────────────────

export type ValidatedCallTask =
  | { ok: true; task: "call_classification"; value: CallClassificationSettings }
  | { ok: true; task: "call_analysis"; value: CallAnalysisSettings }
  | { ok: false; error: string };

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "La configuración no es válida";

/**
 * Valida lo que se quiere guardar. `previous` es lo que habia: sirve para subir
 * `rubric.version` solo cuando cambia algo que afecta los puntajes.
 */
export function validateCallTaskSettings(task: CallTaskKey, input: unknown, previous?: unknown): ValidatedCallTask {
  if (!isObj(input)) return { ok: false, error: "La configuración no es válida" };

  if (task === "call_classification") {
    const parsed = classificationSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const value = parsed.data as CallClassificationSettings;

    const keys = new Set<string>();
    for (const t of value.custom_types) {
      if ((BASE_CALL_TYPES as readonly string[]).includes(t.clave)) return { ok: false, error: `"${t.clave}" ya es un tipo del sistema` };
      if (keys.has(t.clave)) return { ok: false, error: `El tipo "${t.clave}" está repetido` };
      keys.add(t.clave);
    }
    const allowed = new Set(validTypeKeys(value.custom_types));
    const bad = value.rules.find((r) => !allowed.has(r.type));
    if (bad) return { ok: false, error: `La regla apunta a un tipo que no existe: ${bad.type}` };
    return { ok: true, task, value };
  }

  const parsed = analysisSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const rubric = normalizeRubric(parsed.data.rubric);
  const problems = validateRubric(rubric);
  if (problems.length > 0) return { ok: false, error: problems[0] };

  const prevRubric = isObj(previous) && previous.rubric ? normalizeRubric(previous.rubric) : DEFAULT_RUBRIC;
  const baseVersion = prevRubric.version;
  const bumped = rubricScoringChanged(prevRubric, rubric);
  const versioned: Rubric = { ...rubric, version: bumped ? baseVersion + 1 : baseVersion };

  const categories = normalizeCategories(parsed.data.categories);

  return {
    ok: true,
    task,
    value: {
      ...(parsed.data as Omit<CallAnalysisSettings, "rubric" | "categories">),
      rubric: versioned,
      categories,
    },
  };
}

/** Un tipo propio nuevo a partir de su nombre: clave unica y sin choque con los del sistema. */
export function newCustomType(name: string, description: string, existing: CustomCallType[]): CustomCallType {
  const taken = new Set<string>([...BASE_CALL_TYPES, ...existing.map((t) => t.clave)]);
  let clave = slugKey(name) || "tipo";
  let i = 2;
  const base = clave;
  while (taken.has(clave)) clave = `${base}_${i++}`;
  return { clave, nombre: name.trim(), descripcion: description.trim(), archivado: false };
}
