/**
 * Evaluar condiciones de asignación (plano F14), portado de `evalSingleCondition`,
 * `combine` y `evaluateRules` de `run-assignment-rules` (prevxcrm).
 *
 * Dos arreglos respecto del original:
 *  - un operador DESCONOCIDO no coincide (devolvía `true`, y `greater_than` /
 *    `less_than` del editor "coincidían con todo");
 *  - una regla sin ninguna condición NO coincide (se saltea), igual que antes.
 *
 * Todo sin distinguir mayúsculas. Los valores vienen de `buildAssignmentContext`.
 */
import { OPERATORS_WITHOUT_VALUE, type Condition, type ConditionTree, type Conjunction } from "@/lib/sales/conditions-schema";
import type { AssignmentContext } from "./context";

export function evaluateCondition(condition: Condition, context: AssignmentContext): boolean {
  const actual = (context[condition.field] ?? "").toLowerCase().trim();
  const expected = (condition.value ?? "").toLowerCase().trim();

  switch (condition.operator) {
    case "is":
      return actual === expected;
    case "is_not":
      return actual !== expected;
    case "contains":
      return expected !== "" && actual.includes(expected);
    case "not_contains":
      return expected !== "" && !actual.includes(expected);
    case "starts_with":
      return expected !== "" && actual.startsWith(expected);
    case "is_empty":
      return actual === "";
    case "is_not_empty":
      return actual !== "";
    default:
      // Un operador que no conocemos no puede dar "sí": mandaría a todos los contactos por esta regla.
      return false;
  }
}

function combine(results: boolean[], conjunction: Conjunction): boolean {
  if (results.length === 0) return true;
  return conjunction === "or" ? results.some(Boolean) : results.every(Boolean);
}

/**
 * El árbol: las condiciones de la raíz y cada grupo (con su propia conjunción) se
 * combinan con la conjunción de la raíz. Un grupo vacío se saltea. Sin ningún
 * resultado (árbol vacío) no coincide: una regla sin condiciones no asigna.
 */
export function evaluateConditions(tree: ConditionTree, context: AssignmentContext): boolean {
  const rootResults = tree.conditions.map((c) => evaluateCondition(c, context));
  const groupResults: boolean[] = [];
  for (const group of tree.groups) {
    if (group.conditions.length === 0) continue;
    groupResults.push(combine(group.conditions.map((c) => evaluateCondition(c, context)), group.conjunction));
  }
  const all = [...rootResults, ...groupResults];
  if (all.length === 0) return false;
  return combine(all, tree.rootConjunction);
}

export { OPERATORS_WITHOUT_VALUE };
