import { z } from "zod";
import { RULE_FIELDS, RULE_ACTIONS, fieldDef, type RuleAction } from "./fields";
import type { Rule } from "./evaluate";

/**
 * Validación de reglas en el SERVIDOR (F10). Mismo esquema que usa el cliente:
 * la lista cerrada de campos manda. Una regla sin condiciones, con un campo
 * fuera de la lista, con un operador que ese campo no acepta, o con un valor
 * del tipo equivocado, se rechaza con un mensaje claro.
 */

const conditionSchema = z
  .object({
    field: z.string(),
    op: z.string(),
    value: z.unknown(),
  })
  .superRefine((cond, ctx) => {
    const def = fieldDef(cond.field);
    if (!def) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Campo desconocido: ${cond.field}` });
      return;
    }
    if (!def.operators.includes(cond.op as never)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `El operador ${cond.op} no vale para ${cond.field}` });
      return;
    }
    const problem = valueProblem(def.valueType, cond.op, cond.value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

const ruleSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(120).nullish(),
  enabled: z.boolean(),
  conditions: z.array(conditionSchema).min(1, "Una regla necesita al menos una condición"),
  action: z.enum(RULE_ACTIONS as [RuleAction, ...RuleAction[]]),
});

export const rulesListSchema = z.array(ruleSchema).max(50);
export const rulesDefaultSchema = z.enum(RULE_ACTIONS as [RuleAction, ...RuleAction[]]);

function valueProblem(valueType: string, op: string, value: unknown): string | null {
  switch (valueType) {
    case "words":
      if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && v.trim())) {
        return "El valor tiene que ser una lista de palabras no vacía";
      }
      return null;
    case "tags":
      if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string")) {
        return "El valor tiene que ser una lista de etiquetas no vacía";
      }
      return null;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100000) {
        return "El valor tiene que ser un número entre 0 y 100000";
      }
      return null;
    case "bool":
      if (typeof value !== "boolean") return "El valor tiene que ser sí o no";
      return null;
    case "temperature":
      if (!["cold", "warm", "hot"].includes(String(value))) return "Temperatura inválida";
      return null;
    case "channel":
      if (typeof value !== "string" || !value) return "Canal inválido";
      return null;
    case "user":
      if (typeof value !== "string" || !value) return "Usuario inválido";
      return null;
    case "intent": {
      const v = (value ?? {}) as { category_id?: unknown; min_confidence?: unknown };
      if (typeof v.category_id !== "string" || !v.category_id) return "Falta la categoría de intención";
      if (v.min_confidence !== undefined && (typeof v.min_confidence !== "number" || v.min_confidence < 0 || v.min_confidence > 1)) {
        return "La confianza mínima tiene que estar entre 0 y 1";
      }
      return null;
    }
    default:
      return null;
  }
}

export interface ValidateRulesResult {
  ok: boolean;
  rules?: Rule[];
  error?: string;
}

/** Valida una lista de reglas. Devuelve el primer problema legible. */
export function validateRules(raw: unknown): ValidateRulesResult {
  const parsed = rulesListSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Reglas inválidas" };
  }
  // ids únicos.
  const ids = new Set<string>();
  for (const r of parsed.data) {
    if (ids.has(r.id)) return { ok: false, error: `Regla repetida: ${r.id}` };
    ids.add(r.id);
  }
  return { ok: true, rules: parsed.data as Rule[] };
}

export const KNOWN_FIELDS = RULE_FIELDS.map((f) => f.field);
