/** Ediciones inmutables del árbol de condiciones: las usa el constructor de la pantalla (y se prueban solas). */
import type { Condition, ConditionTree, Conjunction } from "./conditions-schema";

export const NEW_CONDITION = (field: string): Condition => ({ field, operator: "contains", value: "" });

export function setRootConjunction(tree: ConditionTree, conjunction: Conjunction): ConditionTree {
  return { ...tree, rootConjunction: conjunction };
}

export function addRootCondition(tree: ConditionTree, field: string): ConditionTree {
  return { ...tree, conditions: [...tree.conditions, NEW_CONDITION(field)] };
}

export function updateRootCondition(tree: ConditionTree, index: number, patch: Partial<Condition>): ConditionTree {
  return { ...tree, conditions: tree.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) };
}

export function removeRootCondition(tree: ConditionTree, index: number): ConditionTree {
  return { ...tree, conditions: tree.conditions.filter((_, i) => i !== index) };
}

export function addGroup(tree: ConditionTree, field: string): ConditionTree {
  return { ...tree, groups: [...tree.groups, { conjunction: "or", conditions: [NEW_CONDITION(field)] }] };
}

export function removeGroup(tree: ConditionTree, groupIndex: number): ConditionTree {
  return { ...tree, groups: tree.groups.filter((_, i) => i !== groupIndex) };
}

export function setGroupConjunction(tree: ConditionTree, groupIndex: number, conjunction: Conjunction): ConditionTree {
  return { ...tree, groups: tree.groups.map((g, i) => (i === groupIndex ? { ...g, conjunction } : g)) };
}

export function addGroupCondition(tree: ConditionTree, groupIndex: number, field: string): ConditionTree {
  return { ...tree, groups: tree.groups.map((g, i) => (i === groupIndex ? { ...g, conditions: [...g.conditions, NEW_CONDITION(field)] } : g)) };
}

export function updateGroupCondition(tree: ConditionTree, groupIndex: number, index: number, patch: Partial<Condition>): ConditionTree {
  return {
    ...tree,
    groups: tree.groups.map((g, i) => (i === groupIndex ? { ...g, conditions: g.conditions.map((c, j) => (j === index ? { ...c, ...patch } : c)) } : g)),
  };
}

export function removeGroupCondition(tree: ConditionTree, groupIndex: number, index: number): ConditionTree {
  return {
    ...tree,
    groups: tree.groups.map((g, i) => (i === groupIndex ? { ...g, conditions: g.conditions.filter((_, j) => j !== index) } : g)),
  };
}
