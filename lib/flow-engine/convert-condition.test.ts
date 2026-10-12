import { describe, it, expect } from "vitest";
import { conditionToBranch, isLegacyCondition, CONVERTED_PATH_LABEL } from "./convert-condition";
import { isGeneratedPathId, validateBranchData } from "./branch-paths";

const OLD = {
  id: "cond-1",
  type: "condition",
  position: { x: 40, y: 200 },
  data: {
    label: "¿Es VIP?",
    logic: "and" as const,
    conditions: [
      { field: "tag:vip", operator: "equals", value: "true" },
      { field: "presupuesto", operator: "gt", value: "100" },
    ],
  },
};

const edges = [
  { id: "t-c", source: "trigger", target: "cond-1" },
  { id: "c-si", source: "cond-1", target: "a", sourceHandle: "true" },
  { id: "c-no", source: "cond-1", target: "b", sourceHandle: "false" },
  { id: "a-z", source: "a", target: "z", sourceHandle: "true" },
];

describe("conditionToBranch", () => {
  const out = conditionToBranch(OLD, edges, { pathId: "p_si0001" });

  it("conserva el id, la posicion y la etiqueta del nodo", () => {
    expect(out.node).toMatchObject({ id: "cond-1", type: "branch", position: { x: 40, y: 200 } });
    expect(out.node.data.label).toBe("¿Es VIP?");
  });

  it("un solo camino con las condiciones VIEJAS tal cual (sin tipo) y la misma logica", () => {
    expect(out.node.data.paths).toEqual([
      { id: "p_si0001", label: CONVERTED_PATH_LABEL, logic: "and", conditions: OLD.data.conditions },
    ]);
    expect(out.node.data.paths[0].conditions[0]).not.toHaveProperty("valueType");
  });

  it("«Si» (true) pasa a ser la salida del camino y «Si no» (false), `else`", () => {
    expect(out.edges.find((e) => e.id === "c-si")!.sourceHandle).toBe("p_si0001");
    expect(out.edges.find((e) => e.id === "c-no")!.sourceHandle).toBe("else");
    expect(out.edges.find((e) => e.id === "c-si")!.target).toBe("a");
    expect(out.edges.find((e) => e.id === "c-no")!.target).toBe("b");
    expect(out.pathId).toBe("p_si0001");
  });

  it("las aristas de otros nodos (aunque tengan handle `true`) y las entrantes no se tocan", () => {
    expect(out.edges.find((e) => e.id === "t-c")).toEqual(edges[0]);
    expect(out.edges.find((e) => e.id === "a-z")).toEqual(edges[3]);
    expect(out.edges).toHaveLength(edges.length);
  });

  it("entiende los alias viejos: yes -> el camino, no -> else", () => {
    const aliased = conditionToBranch(OLD, [{ id: "1", source: "cond-1", target: "a", sourceHandle: "yes" }, { id: "2", source: "cond-1", target: "b", sourceHandle: "no" }], { pathId: "p_si0001" });
    expect(aliased.edges.map((e) => e.sourceHandle)).toEqual(["p_si0001", "else"]);
  });

  it("una arista sin salida declarada queda como estaba (el motor nunca la siguio)", () => {
    const loose = conditionToBranch(OLD, [{ id: "1", source: "cond-1", target: "a" }], { pathId: "p_si0001" });
    expect(loose.edges[0]).toEqual({ id: "1", source: "cond-1", target: "a" });
  });

  it("no modifica lo que recibe", () => {
    const snapshot = JSON.stringify({ OLD, edges });
    conditionToBranch(OLD, edges);
    expect(JSON.stringify({ OLD, edges })).toBe(snapshot);
  });

  it("sin pathId elige uno generado y valido", () => {
    const generated = conditionToBranch(OLD, edges);
    expect(isGeneratedPathId(generated.pathId)).toBe(true);
    expect(validateBranchData(generated.node.data)).toEqual([]);
  });

  it("logic distinto de `and` se vuelve `or` (el nodo viejo trata asi todo lo que no sea `and`)", () => {
    expect(conditionToBranch({ ...OLD, data: { ...OLD.data, logic: undefined } }, []).node.data.paths[0].logic).toBe("or");
    expect(conditionToBranch({ ...OLD, data: { ...OLD.data, logic: "or" } }, []).node.data.paths[0].logic).toBe("or");
  });

  it("datos rotos: sin condiciones valida lo que pueda y no lanza", () => {
    const broken = conditionToBranch({ id: "x", type: "condition", data: undefined }, []);
    expect(broken.node.data.paths[0].conditions).toEqual([]);
    expect(conditionToBranch({ id: "x", type: "condition", data: { conditions: [null, "texto", { field: "a", operator: "exists", value: "" }] } }, []).node.data.paths[0].conditions).toHaveLength(1);
  });

  it("isLegacyCondition", () => {
    expect(isLegacyCondition({ type: "condition" })).toBe(true);
    expect(isLegacyCondition({ type: "branch" })).toBe(false);
  });
});
