import { describe, it, expect } from "vitest";
import { validateBranchData } from "@/lib/flow-engine/branch-paths";
import { MAX_PATHS } from "@/lib/flow-engine/branch-paths";
import {
  ROOT,
  addBranchPath,
  branchLevelOf,
  canAddBranchAt,
  canDuplicate,
  canInsertAt,
  canMove,
  convertGate,
  duplicateStep,
  getList,
  insertMovesTail,
  insertStep,
  locate,
  moveBranchPath,
  moveStep,
  newBranchStep,
  patchBranchPath,
  removeBranchPath,
  removeStep,
  renameBranch,
  renameBranchPath,
  setStepData,
  stepsInside,
  type ListRef,
} from "./step-tree-edit";
import { allIds, allSteps, flowToTree, treeShapeProblems, treeToFlow, type ActionStep, type BranchStep, type GateStep, type Step, type StepTree } from "./step-tree";

const act = (id: string, tagName = id): ActionStep => ({ kind: "action", id, nodeType: "action", data: { actionType: "addTag", tagName } });
const cond = { field: "answer.x", operator: "is", valueType: "single_select" as const, value: "A" };
const path = (id: string, steps: Step[] = []) => ({ id, label: id, logic: "and" as const, conditions: [cond], steps });
const branch = (id: string, paths: ReturnType<typeof path>[], otherwise: Step[] = []): BranchStep => ({ kind: "branch", id, data: {}, paths, otherwise });
const gate = (id: string, steps: Step[] = []): GateStep => ({ kind: "gate", id, data: { conditions: [], logic: "and" }, steps });
const tree = (steps: Step[]): StepTree => ({ trigger: { id: "trigger", data: { triggerType: "form_submitted" } }, steps });

/** Todo arbol que sale de una edicion tiene que seguir siendo un grafo posible. */
function ok(t: StepTree): StepTree {
  expect(treeShapeProblems(t)).toEqual([]);
  const flow = treeToFlow(t);
  expect(flowToTree(flow.nodes, flow.edges)).toEqual(t);
  return t;
}

describe("insertStep", () => {
  it("en la raiz, al principio, en el medio y al final", () => {
    const t = tree([act("a"), act("b")]);
    expect(allSteps(ok(insertStep(t, ROOT, 0, act("x")))).map((s) => s.id)).toEqual(["x", "a", "b"]);
    expect(allSteps(ok(insertStep(t, ROOT, 1, act("x")))).map((s) => s.id)).toEqual(["a", "x", "b"]);
    expect(allSteps(ok(insertStep(t, ROOT, 2, act("x")))).map((s) => s.id)).toEqual(["a", "b", "x"]);
  });

  it("no modifica el arbol original", () => {
    const t = tree([act("a")]);
    insertStep(t, ROOT, 1, act("x"));
    expect(t.steps).toHaveLength(1);
  });

  it("dentro de un camino, de Si no y de un Si", () => {
    const t = tree([branch("b", [path("p1"), path("p2")], [act("e")])]);
    const inPath: ListRef = { where: "path", stepId: "b", pathId: "p2" };
    expect(getList(ok(insertStep(t, inPath, 0, act("x"))), inPath)?.map((s) => s.id)).toEqual(["x"]);
    const inElse: ListRef = { where: "else", stepId: "b" };
    expect(getList(ok(insertStep(t, inElse, 1, act("x"))), inElse)?.map((s) => s.id)).toEqual(["e", "x"]);
    const g = tree([gate("g")]);
    expect(getList(ok(insertStep(g, { where: "gate", stepId: "g" }, 0, act("x"))), { where: "gate", stepId: "g" })?.map((s) => s.id)).toEqual(["x"]);
  });

  it("nunca despues de un Si ni de Condiciones: ahi no hay 'despues'", () => {
    const t = tree([branch("b", [path("p1")])]);
    expect(canInsertAt(t.steps, 1)).toBe(false);
    expect(insertStep(t, ROOT, 1, act("x"))).toBe(t);
    expect(canInsertAt(t.steps, 0)).toBe(true);
    expect(canInsertAt([], 1)).toBe(false);
  });

  it("Condiciones al final: no mueve nada", () => {
    const t = tree([act("a")]);
    const next = ok(insertStep(t, ROOT, 1, newBranchStep(allIds(t), cond, () => 0.3)));
    expect(next.steps.map((s) => s.kind)).toEqual(["action", "branch"]);
    expect(insertMovesTail(t.steps, 1, next.steps[1])).toBe(false);
  });

  it("Condiciones en el medio: lo que seguia pasa ADENTRO del primer camino (no se pierde ni queda afuera)", () => {
    const t = tree([act("a"), act("b"), act("c")]);
    const b = newBranchStep(allIds(t), cond, () => 0.3);
    expect(insertMovesTail(t.steps, 1, b)).toBe(true);
    const next = ok(insertStep(t, ROOT, 1, b));
    expect(next.steps.map((s) => s.id)).toEqual(["a", b.id]);
    const inside = (next.steps[1] as BranchStep).paths[0].steps.map((s) => s.id);
    expect(inside).toEqual(["b", "c"]);
    expect((next.steps[1] as BranchStep).otherwise).toEqual([]);
  });

  it("no se pasa de 3 niveles de Condiciones", () => {
    const deep = tree([branch("1", [path("p1", [branch("2", [path("p2", [branch("3", [path("p3")])])])])])]);
    const level3: ListRef = { where: "path", stepId: "3", pathId: "p3" };
    expect(branchLevelOf(deep, level3)).toBe(3);
    expect(canAddBranchAt(deep, level3)).toBe(false);
    expect(insertStep(deep, level3, 0, newBranchStep(allIds(deep), cond))).toBe(deep);
    // Un paso comun si entra.
    expect(insertStep(deep, level3, 0, act("x"))).not.toBe(deep);
    expect(canAddBranchAt(deep, { where: "path", stepId: "2", pathId: "p2" })).toBe(true);
  });

  it("mover lo que seguia un nivel mas adentro tampoco puede pasar el tope", () => {
    // [Condiciones(2 niveles)] no puede tener nada despues, pero [a, Condiciones(2 niveles)] si: insertar Condiciones antes de a
    // empuja a Condiciones(2 niveles) un nivel mas adentro: serian 4.
    const inner = branch("2", [path("p2", [branch("3", [path("p3")])])]);
    const t = tree([act("a"), branch("1", [path("p1", [inner])])]);
    const b = newBranchStep(allIds(t), cond);
    expect(insertStep(t, ROOT, 1, b)).toBe(t);
  });

  it("un ref que ya no existe no hace nada", () => {
    const t = tree([act("a")]);
    expect(insertStep(t, { where: "gate", stepId: "nada" }, 0, act("x"))).toBe(t);
  });
});

describe("mover, duplicar, borrar", () => {
  it("mover entre pasos sueltos", () => {
    const t = tree([act("a"), act("b"), act("c")]);
    expect(allSteps(ok(moveStep(t, "b", -1))).map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(allSteps(ok(moveStep(t, "b", 1))).map((s) => s.id)).toEqual(["a", "c", "b"]);
    expect(moveStep(t, "a", -1)).toBe(t);
    expect(moveStep(t, "c", 1)).toBe(t);
  });

  it("un Si o Condiciones no se mueven, y nada pasa por encima de ellos", () => {
    const t = tree([act("a"), branch("b", [path("p1")])]);
    expect(canMove(t.steps, 1, -1)).toBe(false);
    expect(canMove(t.steps, 0, 1)).toBe(false);
    expect(moveStep(t, "a", 1)).toBe(t);
    expect(moveStep(t, "b", -1)).toBe(t);
  });

  it("mover adentro de un camino no toca los demas", () => {
    const t = tree([branch("b", [path("p1", [act("x"), act("y")]), path("p2", [act("z")])])]);
    const next = ok(moveStep(t, "y", -1));
    expect(getList(next, { where: "path", stepId: "b", pathId: "p1" })?.map((s) => s.id)).toEqual(["y", "x"]);
    expect(getList(next, { where: "path", stepId: "b", pathId: "p2" })?.map((s) => s.id)).toEqual(["z"]);
  });

  it("duplicar: una copia con otro id justo despues, con los datos sin compartir referencias", () => {
    const t = tree([act("a", "uno"), act("b")]);
    const next = ok(duplicateStep(t, "a", () => 0.7));
    expect(next.steps).toHaveLength(3);
    expect(next.steps[0].id).toBe("a");
    expect(next.steps[1].id).not.toBe("a");
    expect((next.steps[1] as ActionStep).data).toEqual((next.steps[0] as ActionStep).data);
    expect((next.steps[1] as ActionStep).data).not.toBe((next.steps[0] as ActionStep).data);
    expect(new Set(allIds(next)).size).toBe(4);
  });

  it("un Si o Condiciones no se duplican", () => {
    const t = tree([branch("b", [path("p1")])]);
    expect(canDuplicate(t.steps[0])).toBe(false);
    expect(duplicateStep(t, "b")).toBe(t);
  });

  it("borrar saca el paso y todo lo que tenia adentro, y se puede contar antes", () => {
    const t = tree([act("a"), branch("b", [path("p1", [act("x"), branch("c", [path("q1", [act("y")])])]), path("p2")], [act("e")])]);
    expect(stepsInside(t.steps[1])).toBe(4); // x, c, y y e
    expect(stepsInside(t.steps[0])).toBe(0);
    const next = ok(removeStep(t, "b"));
    expect(allSteps(next).map((s) => s.id)).toEqual(["a"]);
    expect(removeStep(t, "nada")).toBe(t);
  });

  it("cambiar los datos de un paso", () => {
    const t = tree([act("a", "viejo")]);
    const next = setStepData(t, "a", { actionType: "addTag", tagName: "nuevo" });
    expect((next.steps[0] as ActionStep).data.tagName).toBe("nuevo");
    expect((t.steps[0] as ActionStep).data.tagName).toBe("viejo");
    // Un Si o Condiciones no se editan por aca.
    const b = tree([branch("b", [path("p1")])]);
    expect(setStepData(b, "b", { x: 1 })).toBe(b);
  });

  it("locate dice donde esta un paso", () => {
    const t = tree([branch("b", [path("p1", [act("x")])])]);
    expect(locate(t, "x")).toMatchObject({ ref: { where: "path", stepId: "b", pathId: "p1" }, index: 0 });
    expect(locate(t, "b")).toMatchObject({ ref: ROOT, index: 0 });
    expect(locate(t, "nada")).toBeUndefined();
  });
});

describe("los caminos de Condiciones", () => {
  const base = () => tree([newBranchStep([], cond, () => 0.25)]);
  const id = (t: StepTree) => t.steps[0].id;
  const paths = (t: StepTree) => (t.steps[0] as BranchStep).paths;

  it("un Condiciones nuevo pasa la validacion de la base y nace con un camino, una condicion y Si no vacio", () => {
    const b = base().steps[0] as BranchStep;
    expect(validateBranchData({ paths: b.paths })).toEqual([]);
    expect(b.paths).toHaveLength(1);
    expect(b.paths[0].label).toBe("Camino 1");
    expect(b.otherwise).toEqual([]);
    ok(base());
  });

  it("agregar un camino al final, con nombre 'Camino N' y su propia condicion", () => {
    const t = ok(addBranchPath(base(), id(base()), cond));
    expect(paths(t).map((p) => p.label)).toEqual(["Camino 1", "Camino 2"]);
    expect(new Set(paths(t).map((p) => p.id)).size).toBe(2);
    expect(paths(t)[1].conditions).toEqual([cond]);
  });

  it("hasta 10 caminos", () => {
    let t = base();
    for (let i = 0; i < 20; i++) t = addBranchPath(t, id(t), cond);
    expect(paths(t)).toHaveLength(MAX_PATHS);
  });

  it("borrar un camino se lleva sus pasos; el ultimo no se borra", () => {
    let t = addBranchPath(base(), id(base()), cond);
    const [first, second] = paths(t);
    t = insertStep(t, { where: "path", stepId: id(t), pathId: second.id }, 0, act("x"));
    t = ok(removeBranchPath(t, id(t), second.id));
    expect(paths(t).map((p) => p.id)).toEqual([first.id]);
    expect(allSteps(t).some((s) => s.id === "x")).toBe(false);
    expect(removeBranchPath(t, id(t), first.id)).toBe(t);
  });

  it("renombrar y reordenar no cambian ids ni pasos", () => {
    let t = addBranchPath(base(), id(base()), cond);
    const [first, second] = paths(t);
    t = insertStep(t, { where: "path", stepId: id(t), pathId: first.id }, 0, act("x"));
    t = ok(renameBranchPath(t, id(t), first.id, "Calificados"));
    t = ok(moveBranchPath(t, id(t), first.id, 1));
    expect(paths(t).map((p) => [p.id, p.label])).toEqual([[second.id, "Camino 2"], [first.id, "Calificados"]]);
    expect(paths(t)[1].steps.map((s) => s.id)).toEqual(["x"]);
  });

  it("cambiar las condiciones o el 'y / o' de un camino", () => {
    const t0 = base();
    const p = paths(t0)[0];
    const t = ok(patchBranchPath(t0, id(t0), p.id, { logic: "or", conditions: [cond, { ...cond, value: "B" }] }));
    expect(paths(t)[0]).toMatchObject({ logic: "or" });
    expect(paths(t)[0].conditions).toHaveLength(2);
    expect(paths(t)[0].id).toBe(p.id);
  });

  it("el nombre del nodo", () => {
    const t0 = base();
    expect((renameBranch(t0, id(t0), "Según facturación").steps[0] as BranchStep).data.label).toBe("Según facturación");
    expect("label" in (renameBranch(renameBranch(t0, id(t0), "x"), id(t0), "  ").steps[0] as BranchStep).data).toBe(false);
  });

  it("operar sobre algo que no es Condiciones no hace nada", () => {
    const t = tree([act("a")]);
    expect(addBranchPath(t, "a")).toBe(t);
    expect(removeBranchPath(t, "a", "p")).toBe(t);
  });
});

describe("convertir un Si", () => {
  it("queda el mismo id y los mismos pasos, ahora adentro del camino 'Si'", () => {
    const t = tree([act("a"), { ...gate("g", [act("x"), act("y")]), data: { conditions: [{ field: "tag:vip", operator: "equals", value: "true" }], logic: "and" } }]);
    const next = ok(convertGate(t, "g", () => 0.4));
    const b = next.steps[1] as BranchStep;
    expect(b).toMatchObject({ kind: "branch", id: "g", otherwise: [] });
    expect(b.paths[0]).toMatchObject({ label: "Si", logic: "and" });
    expect(b.paths[0].steps.map((s) => s.id)).toEqual(["x", "y"]);
    expect(validateBranchData({ paths: b.paths })).toEqual([]);
  });

  it("no convierte lo que no es un Si, ni pasa del tope de niveles", () => {
    const t = tree([act("a")]);
    expect(convertGate(t, "a")).toBe(t);
    const deep = tree([branch("1", [path("p1", [branch("2", [path("p2", [branch("3", [path("p3", [gate("g")])])])])])])]);
    expect(convertGate(deep, "g")).toBe(deep);
  });
});
