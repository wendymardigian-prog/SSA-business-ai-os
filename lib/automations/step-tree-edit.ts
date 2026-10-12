/**
 * Editar un arbol de pasos: insertar, mover, duplicar, borrar y cambiar los
 * caminos de Condiciones. PURO e inmutable: cada funcion devuelve un arbol
 * nuevo (o el mismo, tal cual, si la operacion no se puede). El editor solo
 * llama a esto; no decide nada por su cuenta.
 *
 * Reglas del arbol que estas funciones cuidan (las mismas que `treeShapeProblems`):
 *  - Un "Si" y un nodo Condiciones son SIEMPRE el ultimo paso de su lista: lo que
 *    sigue va adentro (de un camino, de "Si no", del Si). No hay fusion.
 *  - Hasta `MAX_BRANCH_DEPTH` niveles de Condiciones.
 *  - Cada camino termina en si mismo.
 */

import { addPath, blankBranchPath, movePath, patchPath, removePath, renamePath } from "./branch-edit";
import { newPathId } from "@/lib/flow-engine/branch-paths";
import type { BranchCondition, BranchPath } from "@/lib/flow-engine/condition-eval";
import {
  MAX_BRANCH_DEPTH,
  allIds,
  allSteps,
  branchDepth,
  childLists,
  gateToBranch,
  newStepId,
  type ActionStep,
  type BranchPathStep,
  type BranchStep,
  type GateStep,
  type NodeData,
  type Step,
  type StepTree,
} from "./step-tree";

// ------------------------------------------------------------
// Donde esta una lista de pasos
// ------------------------------------------------------------

export type ListRef =
  | { where: "root" }
  | { where: "gate"; stepId: string }
  | { where: "path"; stepId: string; pathId: string }
  | { where: "else"; stepId: string };

export const ROOT: ListRef = { where: "root" };

const same = (a: ListRef, b: ListRef): boolean =>
  a.where === b.where &&
  ("stepId" in a ? a.stepId : "") === ("stepId" in b ? b.stepId : "") &&
  ("pathId" in a ? a.pathId : "") === ("pathId" in b ? b.pathId : "");

/** Aplica `fn` a la lista que `ref` senala, dejando el resto igual. */
function editList(steps: Step[], ref: ListRef, fn: (list: Step[]) => Step[]): Step[] {
  return steps.map((step): Step => {
    if (step.kind === "gate") {
      if (ref.where === "gate" && ref.stepId === step.id) return { ...step, steps: fn(step.steps) };
      return { ...step, steps: editList(step.steps, ref, fn) };
    }
    if (step.kind === "branch") {
      return {
        ...step,
        paths: step.paths.map((p) =>
          ref.where === "path" && ref.stepId === step.id && ref.pathId === p.id ? { ...p, steps: fn(p.steps) } : { ...p, steps: editList(p.steps, ref, fn) },
        ),
        otherwise: ref.where === "else" && ref.stepId === step.id ? fn(step.otherwise) : editList(step.otherwise, ref, fn),
      };
    }
    return step;
  });
}

function withList(tree: StepTree, ref: ListRef, fn: (list: Step[]) => Step[]): StepTree {
  return ref.where === "root" ? { ...tree, steps: fn(tree.steps) } : { ...tree, steps: editList(tree.steps, ref, fn) };
}

/** La lista que `ref` senala, o `undefined` si ya no existe. */
export function getList(tree: StepTree, ref: ListRef): Step[] | undefined {
  if (ref.where === "root") return tree.steps;
  for (const step of allSteps(tree)) {
    if (step.id !== (ref as { stepId: string }).stepId) continue;
    if (ref.where === "gate" && step.kind === "gate") return step.steps;
    if (ref.where === "else" && step.kind === "branch") return step.otherwise;
    if (ref.where === "path" && step.kind === "branch") return step.paths.find((p) => p.id === ref.pathId)?.steps;
  }
  return undefined;
}

/** Donde esta un paso: su lista, su posicion. */
export function locate(tree: StepTree, stepId: string): { ref: ListRef; index: number; list: Step[] } | undefined {
  const lists: Array<{ ref: ListRef; list: Step[] }> = [{ ref: ROOT, list: tree.steps }];
  for (const step of allSteps(tree)) {
    if (step.kind === "gate") lists.push({ ref: { where: "gate", stepId: step.id }, list: step.steps });
    if (step.kind === "branch") {
      for (const p of step.paths) lists.push({ ref: { where: "path", stepId: step.id, pathId: p.id }, list: p.steps });
      lists.push({ ref: { where: "else", stepId: step.id }, list: step.otherwise });
    }
  }
  for (const { ref, list } of lists) {
    const index = list.findIndex((s) => s.id === stepId);
    if (index >= 0) return { ref, index, list };
  }
  return undefined;
}

/** Cuantos niveles de Condiciones hay POR ENCIMA de esta lista (0 en la raiz o dentro de un Si de la raiz). */
export function branchLevelOf(tree: StepTree, ref: ListRef): number {
  let found = -1;
  const visit = (steps: Step[], here: ListRef, level: number) => {
    if (same(here, ref)) found = level;
    for (const step of steps) {
      if (step.kind === "gate") visit(step.steps, { where: "gate", stepId: step.id }, level);
      if (step.kind === "branch") {
        for (const p of step.paths) visit(p.steps, { where: "path", stepId: step.id, pathId: p.id }, level + 1);
        visit(step.otherwise, { where: "else", stepId: step.id }, level + 1);
      }
    }
  };
  visit(tree.steps, ROOT, 0);
  return found < 0 ? 0 : found;
}

export const isContainer = (step: Step): step is GateStep | BranchStep => step.kind === "gate" || step.kind === "branch";

// ------------------------------------------------------------
// Insertar
// ------------------------------------------------------------

/** ¿Se puede poner un "+ Agregar paso" en esta posicion? No despues de un Si ni de Condiciones: ahi no hay "despues". */
export function canInsertAt(list: Step[], index: number): boolean {
  if (index < 0 || index > list.length) return false;
  return index === 0 || !isContainer(list[index - 1]);
}

/** ¿Se puede agregar Condiciones en esta lista? Hasta 3 niveles. */
export function canAddBranchAt(tree: StepTree, ref: ListRef): boolean {
  return branchLevelOf(tree, ref) < MAX_BRANCH_DEPTH;
}

/** Al insertar Condiciones en el medio de una lista, lo que seguia no tiene a donde ir salvo adentro: pasa al primer camino. */
export function insertMovesTail(list: Step[], index: number, step: Step): boolean {
  return isContainer(step) && index < list.length;
}

/**
 * Pone un paso en una posicion de una lista. Si es Condiciones (o un Si) y
 * seguian otros pasos, esos pasan ADENTRO del primer camino (el Si, o el primero):
 * es lo unico que no los pierde ni los pone fuera de la condicion sin avisar.
 */
export function insertStep(tree: StepTree, ref: ListRef, index: number, step: Step): StepTree {
  const list = getList(tree, ref);
  if (!list || !canInsertAt(list, index)) return tree;
  if (step.kind === "branch" && !canAddBranchAt(tree, ref)) return tree;
  // Lo que seguia pasa un nivel mas adentro: si ya tenia Condiciones, no se puede pasar del tope.
  if (step.kind === "branch" && index < list.length && branchLevelOf(tree, ref) + 1 + branchDepth(list.slice(index)) > MAX_BRANCH_DEPTH) return tree;

  return withList(tree, ref, (current) => {
    const head = current.slice(0, index);
    const tail = current.slice(index);
    if (!isContainer(step) || tail.length === 0) return [...head, step, ...tail];
    if (step.kind === "gate") return [...head, { ...step, steps: [...step.steps, ...tail] }];
    const [first, ...others] = step.paths;
    return [...head, { ...step, paths: first ? [{ ...first, steps: [...first.steps, ...tail] }, ...others] : step.paths }];
  });
}

/** Un nodo Condiciones nuevo: un camino ("Camino 1") con una condicion en blanco, y "Si no" vacio. */
export function newBranchStep(taken: Iterable<string>, firstCondition?: BranchCondition, random?: () => number): BranchStep {
  const pathId = newPathId([], random);
  return {
    kind: "branch",
    id: newStepId(taken, random),
    data: {},
    paths: [{ ...blankBranchPath(pathId, "Camino 1", firstCondition), steps: [] }],
    otherwise: [],
  };
}

// ------------------------------------------------------------
// Mover, duplicar, borrar, cambiar
// ------------------------------------------------------------

/** ¿Se puede mover este paso hacia arriba (-1) o abajo (+1)? Un Si y Condiciones no se mueven: tienen que quedar al final. */
export function canMove(list: Step[], index: number, direction: -1 | 1): boolean {
  const to = index + direction;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return false;
  return !isContainer(list[index]) && !isContainer(list[to]);
}

export function moveStep(tree: StepTree, stepId: string, direction: -1 | 1): StepTree {
  const at = locate(tree, stepId);
  if (!at || !canMove(at.list, at.index, direction)) return tree;
  return withList(tree, at.ref, (list) => {
    const next = [...list];
    [next[at.index], next[at.index + direction]] = [next[at.index + direction], next[at.index]];
    return next;
  });
}

/** Un paso suelto se puede duplicar; un Si o Condiciones no (arrastran todo lo que tienen adentro). */
export function canDuplicate(step: Step): step is ActionStep {
  return step.kind === "action";
}

export function duplicateStep(tree: StepTree, stepId: string, random?: () => number): StepTree {
  const at = locate(tree, stepId);
  const step = at?.list[at.index];
  if (!at || !step || !canDuplicate(step)) return tree;
  const copy: ActionStep = { ...step, id: newStepId(allIds(tree), random), data: structuredClone(step.data) };
  return withList(tree, at.ref, (list) => [...list.slice(0, at.index + 1), copy, ...list.slice(at.index + 1)]);
}

/** Cuantos pasos hay adentro de un Si o de Condiciones (para pedir confirmacion antes de borrar). */
export function stepsInside(step: Step): number {
  return childLists(step).reduce((n, list) => n + list.length + list.reduce((m, s) => m + stepsInside(s), 0), 0);
}

export function removeStep(tree: StepTree, stepId: string): StepTree {
  const at = locate(tree, stepId);
  if (!at) return tree;
  return withList(tree, at.ref, (list) => list.filter((s) => s.id !== stepId));
}

/** Cambia los datos de un paso suelto (el editor manda los datos completos, no un parche). */
export function setStepData(tree: StepTree, stepId: string, data: NodeData): StepTree {
  const at = locate(tree, stepId);
  const step = at?.list[at.index];
  if (!at || !step || step.kind !== "action") return tree;
  return withList(tree, at.ref, (list) => list.map((s) => (s.id === stepId ? { ...s, data } : s)));
}

/** Cambia un paso por otro del mismo lugar (por ejemplo, un Si convertido en Condiciones). */
export function replaceStep(tree: StepTree, stepId: string, next: Step): StepTree {
  const at = locate(tree, stepId);
  if (!at) return tree;
  return withList(tree, at.ref, (list) => list.map((s) => (s.id === stepId ? next : s)));
}

/** "Convertir a Condiciones" en un Si. */
export function convertGate(tree: StepTree, stepId: string, random?: () => number): StepTree {
  const at = locate(tree, stepId);
  const step = at?.list[at.index];
  if (!at || !step || step.kind !== "gate") return tree;
  // Una conversion no suma un nivel salvo que la lista ya este en el tope.
  if (!canAddBranchAt(tree, at.ref)) return tree;
  return replaceStep(tree, stepId, gateToBranch(step, { random }));
}

// ------------------------------------------------------------
// Los caminos de un nodo Condiciones
// ------------------------------------------------------------

function mapBranch(tree: StepTree, stepId: string, fn: (branch: BranchStep) => BranchStep): StepTree {
  const at = locate(tree, stepId);
  const step = at?.list[at.index];
  if (!at || !step || step.kind !== "branch") return tree;
  const next = fn(step);
  // Una operacion que no cambio nada (borrar el ultimo camino, agregar el numero 11) devuelve el mismo arbol.
  if (next === step || (next.paths === step.paths && next.otherwise === step.otherwise && next.data === step.data)) return tree;
  return withList(tree, at.ref, (list) => list.map((s) => (s.id === stepId ? next : s)));
}

export function addBranchPath(tree: StepTree, branchId: string, firstCondition?: BranchCondition, random?: () => number): StepTree {
  return mapBranch(tree, branchId, (b) => ({
    ...b,
    paths: addPath<BranchPathStep>(b.paths, (id, label) => ({ ...blankBranchPath(id, label, firstCondition), steps: [] }), random),
  }));
}

export function removeBranchPath(tree: StepTree, branchId: string, pathId: string): StepTree {
  return mapBranch(tree, branchId, (b) => ({ ...b, paths: removePath(b.paths, pathId) }));
}

export function renameBranchPath(tree: StepTree, branchId: string, pathId: string, label: string): StepTree {
  return mapBranch(tree, branchId, (b) => ({ ...b, paths: renamePath(b.paths, pathId, label) }));
}

export function moveBranchPath(tree: StepTree, branchId: string, pathId: string, direction: -1 | 1): StepTree {
  return mapBranch(tree, branchId, (b) => ({ ...b, paths: movePath(b.paths, pathId, direction) }));
}

/** Cambia las condiciones o el "y / o" de un camino. */
export function patchBranchPath(tree: StepTree, branchId: string, pathId: string, patch: Partial<Pick<BranchPath, "logic" | "conditions">>): StepTree {
  return mapBranch(tree, branchId, (b) => ({ ...b, paths: patchPath<BranchPathStep>(b.paths, pathId, patch) }));
}

/** El nombre del nodo Condiciones (opcional: sin nombre se llama "Condiciones"). */
export function renameBranch(tree: StepTree, branchId: string, label: string): StepTree {
  return mapBranch(tree, branchId, (b) => {
    const data = { ...b.data };
    if (label.trim() === "") delete data.label;
    else data.label = label;
    return { ...b, data };
  });
}
