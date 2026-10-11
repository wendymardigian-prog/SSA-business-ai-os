/** Tipos de las condiciones de mostrar u ocultar un campo (F5). Sin lógica. */

export const CONDITION_OPERATORS = [
  "is",
  "is_not",
  "contains",
  "not_contains",
  "gt",
  "lt",
  "gte",
  "lte",
  "is_empty",
  "is_not_empty",
  "includes_any",
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export interface Condition {
  /** Solo para la interfaz (la clave de React del renglón). */
  id?: string;
  fieldKey: string;
  operator: ConditionOperator;
  value: string;
}

export interface ConditionGroup {
  id?: string;
  conjunction: "and" | "or";
  conditions: Condition[];
}

export interface VisibilityConfig {
  rootConjunction: "and" | "or";
  conditions: Condition[];
  groups: ConditionGroup[];
}

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  is: "es",
  is_not: "no es",
  contains: "contiene",
  not_contains: "no contiene",
  gt: "es mayor que",
  lt: "es menor que",
  gte: "es mayor o igual a",
  lte: "es menor o igual a",
  is_empty: "está vacío",
  is_not_empty: "tiene valor",
  includes_any: "incluye alguna de",
};

/** Operadores que no necesitan un valor. */
export const UNARY_OPERATORS: ConditionOperator[] = ["is_empty", "is_not_empty"];
