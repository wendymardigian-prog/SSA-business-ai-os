/**
 * El árbol de condiciones (plano §9.2), portado de `reparto-condiciones.ts` de
 * prevxcrm. Es la forma que guardan las reglas de asignación en
 * `assignment_rules.condition_rules[].conditions` y la misma que va a usar la
 * fase futura de reglas de atribución.
 *
 *   { rootConjunction: 'and' | 'or', conditions: [{field, operator, value}],
 *     groups: [{ conjunction, conditions: [...] }] }
 *
 * Un solo nivel de grupos. Lo guardado viene de la base: se lee SIN confiar en
 * su forma (`readConditionTree`), y lo que se guarda se limpia (`serializeConditionTree`):
 * una fila a medio llenar no se guarda, porque haría que la regla no coincida
 * con nada por algo que la persona todavía estaba escribiendo.
 *
 * Módulo PURO. Lo valida con Zod la Server Action que guarda la regla.
 */
import { z } from "zod";

export const CONDITION_OPERATORS = ["is", "is_not", "contains", "not_contains", "starts_with", "is_empty", "is_not_empty"] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const CONDITION_OPERATOR_LABELS: Record<ConditionOperator, string> = {
  is: "es",
  is_not: "no es",
  contains: "contiene",
  not_contains: "no contiene",
  starts_with: "empieza con",
  is_empty: "está vacío",
  is_not_empty: "no está vacío",
};

/** Los dos operadores que no necesitan valor escrito. */
export const OPERATORS_WITHOUT_VALUE: readonly ConditionOperator[] = ["is_empty", "is_not_empty"];

export type Conjunction = "and" | "or";

export interface Condition {
  field: string;
  operator: string;
  value: string;
}

export interface ConditionGroup {
  conjunction: Conjunction;
  conditions: Condition[];
}

export interface ConditionTree {
  rootConjunction: Conjunction;
  conditions: Condition[];
  groups: ConditionGroup[];
}

export const EMPTY_CONDITION_TREE: ConditionTree = { rootConjunction: "and", conditions: [], groups: [] };

const conditionSchema = z.object({
  field: z.string().min(1).max(80),
  operator: z.enum(CONDITION_OPERATORS),
  value: z.string().max(200),
});

export const conditionTreeSchema = z.object({
  rootConjunction: z.enum(["and", "or"]),
  conditions: z.array(conditionSchema).max(30),
  groups: z.array(z.object({ conjunction: z.enum(["and", "or"]), conditions: z.array(conditionSchema).max(30) })).max(10),
});

const isOperator = (op: string): op is ConditionOperator => (CONDITION_OPERATORS as readonly string[]).includes(op);

/**
 * Una fila cuenta solo si el campo es válido, el operador es válido y, cuando el
 * operador lo necesita, hay un valor escrito. `validFields` es la lista de campos
 * del contexto de quien arma las reglas.
 */
export function conditionUseful(c: Condition | null | undefined, validFields: readonly string[]): boolean {
  if (!c || !validFields.includes(c.field) || !isOperator(c.operator)) return false;
  if (OPERATORS_WITHOUT_VALUE.includes(c.operator)) return true;
  return typeof c.value === "string" && c.value.trim() !== "";
}

const asCondition = (c: unknown): Condition => {
  const row = (c ?? {}) as Record<string, unknown>;
  return { field: String(row.field ?? ""), operator: String(row.operator ?? "contains"), value: String(row.value ?? "") };
};

/** Lee lo guardado sin confiar en su forma: viene de la base. */
export function readConditionTree(value: unknown): ConditionTree {
  const raw = (value ?? {}) as Record<string, unknown>;
  const groups = Array.isArray(raw.groups) ? (raw.groups as unknown[]) : [];
  return {
    rootConjunction: raw.rootConjunction === "or" ? "or" : "and",
    conditions: (Array.isArray(raw.conditions) ? (raw.conditions as unknown[]) : []).map(asCondition),
    groups: groups.map((g) => {
      const group = (g ?? {}) as Record<string, unknown>;
      return {
        conjunction: group.conjunction === "or" ? "or" : "and",
        conditions: (Array.isArray(group.conditions) ? (group.conditions as unknown[]) : []).map(asCondition),
      };
    }),
  };
}

/**
 * Lo que se guarda: sin las filas a medio llenar ni los grupos vacíos. Devuelve
 * `undefined` cuando no quedó ninguna condición útil (la regla no tiene condiciones).
 */
export function serializeConditionTree(tree: ConditionTree, validFields: readonly string[]): ConditionTree | undefined {
  const rows = (tree.conditions ?? []).filter((c) => conditionUseful(c, validFields));
  const groups = (tree.groups ?? [])
    .map((g) => ({
      conjunction: g.conjunction === "or" ? ("or" as const) : ("and" as const),
      conditions: (g.conditions ?? []).filter((c) => conditionUseful(c, validFields)),
    }))
    .filter((g) => g.conditions.length > 0);

  if (rows.length === 0 && groups.length === 0) return undefined;
  return { rootConjunction: tree.rootConjunction === "or" ? "or" : "and", conditions: rows, groups };
}
