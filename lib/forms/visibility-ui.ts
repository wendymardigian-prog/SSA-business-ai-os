/**
 * Qué ofrece el constructor de condiciones para cada tipo de campo. Puro.
 */
import type { FormFieldType } from "./fields";
import { OPERATOR_LABELS, UNARY_OPERATORS, type ConditionOperator } from "./visibility-types";

const TEXT: ConditionOperator[] = ["is", "is_not", "contains", "not_contains", "is_empty", "is_not_empty"];
const NUMERIC: ConditionOperator[] = ["is", "is_not", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"];

const BY_TYPE: Record<FormFieldType, ConditionOperator[]> = {
  short_text: TEXT,
  long_text: TEXT,
  email: TEXT,
  phone: TEXT,
  hidden: TEXT,
  social: TEXT,
  number: NUMERIC,
  rating: NUMERIC,
  nps: NUMERIC,
  date: ["is", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  single_select: ["is", "is_not", "includes_any", "is_empty", "is_not_empty"],
  multi_select: ["contains", "not_contains", "includes_any", "is_empty", "is_not_empty"],
  consent: ["is"],
  file: ["is_empty", "is_not_empty"],
};

export function operatorsFor(type: FormFieldType): Array<{ value: ConditionOperator; label: string }> {
  return BY_TYPE[type].map((value) => ({ value, label: OPERATOR_LABELS[value] }));
}

export function needsValue(operator: ConditionOperator): boolean {
  return !UNARY_OPERATORS.includes(operator);
}

/** Cómo se pide el valor: lista de opciones, sí/no o texto libre. */
export type ValueInput = "options" | "boolean" | "number" | "date" | "text" | "none";

export function valueInputFor(type: FormFieldType, operator: ConditionOperator): ValueInput {
  if (!needsValue(operator)) return "none";
  if (type === "consent") return "boolean";
  if ((type === "single_select" || type === "multi_select") && operator !== "includes_any") return "options";
  if (type === "number" || type === "rating" || type === "nps") return "number";
  if (type === "date") return "date";
  return "text";
}

/** El operador que corresponde cuando se cambia de campo y el anterior ya no aplica. */
export function defaultOperatorFor(type: FormFieldType): ConditionOperator {
  return BY_TYPE[type][0];
}

export function isOperatorValidFor(type: FormFieldType, operator: ConditionOperator): boolean {
  return BY_TYPE[type].includes(operator);
}
