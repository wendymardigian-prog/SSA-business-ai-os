import { describe, expect, it } from "vitest";
import type { ConditionTree } from "@/lib/sales/conditions-schema";
import { evaluateCondition, evaluateConditions } from "./conditions";

const ctx = { last_combined: "instagram|paid_social|jose-reels-oct||", first_combined: "google|||", last_fbclid: "", last_source: "instagram", country: "CR" };
const c = (field: string, operator: string, value = "") => ({ field, operator, value });

describe("evaluateConditions", () => {
  it("or: 'la campaña contiene el nombre del setter' en el último O el primer toque → true", () => {
    const tree: ConditionTree = { rootConjunction: "or", conditions: [c("last_combined", "contains", "jose"), c("first_combined", "contains", "jose")], groups: [] };
    expect(evaluateConditions(tree, ctx)).toBe(true);
  });

  it("and con solo el último coincidiendo → false", () => {
    const tree: ConditionTree = { rootConjunction: "and", conditions: [c("last_combined", "contains", "jose"), c("first_combined", "contains", "jose")], groups: [] };
    expect(evaluateConditions(tree, ctx)).toBe(false);
  });

  it("un grupo (A or B) combinado con and a C se evalúa como (A or B) and C", () => {
    const A = c("last_source", "is", "tiktok");
    const B = c("last_source", "is", "instagram");
    const C = c("country", "is", "CR");
    const tree: ConditionTree = { rootConjunction: "and", conditions: [C], groups: [{ conjunction: "or", conditions: [A, B] }] };
    expect(evaluateConditions(tree, ctx)).toBe(true);
    expect(evaluateConditions({ ...tree, conditions: [c("country", "is", "US")] }, ctx)).toBe(false);
    expect(evaluateConditions({ ...tree, groups: [{ conjunction: "or", conditions: [A] }] }, ctx)).toBe(false);
  });

  it("is_empty sobre un campo ausente → true; contains no distingue mayúsculas", () => {
    expect(evaluateCondition(c("last_fbclid", "is_empty"), ctx)).toBe(true);
    expect(evaluateCondition(c("last_combined", "contains", "Jose"), ctx)).toBe(true);
    expect(evaluateCondition(c("nunca_existio", "is_empty"), ctx)).toBe(true);
  });

  it("is, is_not, not_contains, starts_with, is_not_empty", () => {
    expect(evaluateCondition(c("last_source", "is", "INSTAGRAM"), ctx)).toBe(true);
    expect(evaluateCondition(c("last_source", "is_not", "tiktok"), ctx)).toBe(true);
    expect(evaluateCondition(c("last_combined", "not_contains", "tiktok"), ctx)).toBe(true);
    expect(evaluateCondition(c("last_combined", "starts_with", "instagram|"), ctx)).toBe(true);
    expect(evaluateCondition(c("last_source", "is_not_empty"), ctx)).toBe(true);
  });

  it("un operador desconocido NO coincide (el original de prevxcrm devolvía true)", () => {
    expect(evaluateCondition(c("last_source", "greater_than", "1"), ctx)).toBe(false);
    expect(evaluateCondition(c("last_source", "regex", ".*"), ctx)).toBe(false);
  });

  it("un valor vacío con contains no coincide con todo", () => {
    expect(evaluateCondition(c("last_source", "contains", ""), ctx)).toBe(false);
  });

  it("un árbol sin condiciones no coincide (la regla no asigna a nadie)", () => {
    expect(evaluateConditions({ rootConjunction: "and", conditions: [], groups: [] }, ctx)).toBe(false);
    expect(evaluateConditions({ rootConjunction: "or", conditions: [], groups: [{ conjunction: "and", conditions: [] }] }, ctx)).toBe(false);
  });
});
