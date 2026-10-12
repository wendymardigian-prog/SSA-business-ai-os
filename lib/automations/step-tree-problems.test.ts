import { describe, it, expect } from "vitest";
import { builderFieldFromSpec } from "./condition-builder-model";
import { treeConditionProblems } from "./step-tree-problems";
import type { BranchStep, StepTree } from "./step-tree";

const fact = builderFieldFromSpec({ path: "answer.facturacion", label: "Facturación", type: "single_select", options: [{ value: "A", label: "A" }] });
const tree = (b: BranchStep): StepTree => ({ trigger: { id: "t", data: {} }, steps: [b] });
const branch = (paths: BranchStep["paths"]): BranchStep => ({ kind: "branch", id: "b", data: {}, paths, otherwise: [] });
const path = (id: string, label: string, conditions: BranchStep["paths"][number]["conditions"]) => ({ id, label, logic: "and" as const, conditions, steps: [] });

describe("treeConditionProblems", () => {
  it("un camino completo no tiene problemas", () => {
    const t = tree(branch([path("p1", "A", [{ field: "answer.facturacion", operator: "is", valueType: "single_select", value: "A" }])]));
    expect(treeConditionProblems(t, () => [fact])).toEqual([]);
  });

  it("una condicion sin valor se nombra con el camino", () => {
    const t = tree(branch([path("p1", "Calificados", [{ field: "answer.facturacion", operator: "is", valueType: "single_select", value: "" }])]));
    const [problem] = treeConditionProblems(t, () => [fact]);
    expect(problem).toMatchObject({ stepId: "b", pathId: "p1" });
    expect(problem.message).toBe("El camino «Calificados» tiene una condición sin completar: elegí una opción.");
  });

  it("un camino sin condiciones se cumpliria siempre; sin nombre se llama 'Camino N'", () => {
    const t = tree(branch([path("p1", "", [])]));
    expect(treeConditionProblems(t, () => [fact])[0].message).toMatch(/«Camino 1» no tiene condiciones/);
  });

  it("un campo que ya no existe es un problema; una condicion vieja (nodo condition) no", () => {
    const stale = tree(branch([path("p1", "A", [{ field: "answer.borrada", operator: "is", valueType: "text", value: "x" }])]));
    expect(treeConditionProblems(stale, () => [fact])[0].message).toMatch(/elegí un campo/);
    const legacy = tree(branch([path("p1", "A", [{ field: "tag:vip", operator: "equals", value: "true" }])]));
    expect(treeConditionProblems(legacy, () => [fact])).toEqual([]);
  });

  it("uno por camino, y mira los Condiciones de adentro", () => {
    const inner = branch([path("q1", "Adentro", [])]);
    const outer: BranchStep = { kind: "branch", id: "o", data: {}, paths: [{ ...path("p1", "A", []), steps: [{ ...inner, id: "i" }] }], otherwise: [] };
    const out = treeConditionProblems(tree(outer), () => [fact]);
    expect(out.map((p) => [p.stepId, p.pathId])).toEqual([["o", "p1"], ["i", "q1"]]);
  });
});
