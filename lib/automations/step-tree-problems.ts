/**
 * Lo que falta completar en un arbol de pasos antes de guardarlo. PURO.
 *
 * Una condicion a medio armar (sin valor, sin campo) NUNCA se cumple: guardarla
 * deja un camino que no recibe a nadie sin que se note. Por eso el editor la
 * frena antes de guardar, con el nombre del camino. Los pasos comunes
 * (un email vacio) no se frenan: son validos y el servidor ya rechaza lo que
 * no puede guardar.
 */

import { conditionProblem, fieldOfCondition, type BuilderField } from "./condition-builder-model";
import { pathDisplayLabel } from "./branch-edit";
import { allSteps, type StepTree } from "./step-tree";

export interface TreeProblem {
  stepId: string;
  pathId: string;
  message: string;
}

/** `fieldsFor` devuelve los campos que se reconocen en el punto del flujo donde esta ese nodo Condiciones. */
export function treeConditionProblems(tree: StepTree, fieldsFor: (branchId: string) => BuilderField[]): TreeProblem[] {
  const out: TreeProblem[] = [];
  for (const step of allSteps(tree)) {
    if (step.kind !== "branch") continue;
    const fields = fieldsFor(step.id);
    step.paths.forEach((path, index) => {
      const name = pathDisplayLabel(path, index);
      if (path.conditions.length === 0) {
        out.push({ stepId: step.id, pathId: path.id, message: `El camino «${name}» no tiene condiciones: se cumpliría siempre.` });
        return;
      }
      for (const condition of path.conditions) {
        const problem = conditionProblem(condition, fieldOfCondition(fields, condition.field));
        if (problem) {
          out.push({ stepId: step.id, pathId: path.id, message: `El camino «${name}» tiene una condición sin completar: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}` });
          break;
        }
      }
    });
  }
  return out;
}
