/**
 * "Probar condiciones": explicar, SIN ejecutar nada, por que camino iria cada
 * nodo Condiciones de un arbol de pasos con unos valores de prueba. PURO: sin
 * Supabase, sin React, sin reloj suelto (`now` entra por parametro).
 *
 * Es el mismo calculo que hace el motor, no una copia:
 *   - el camino lo elige `pickPath` (condition-eval.ts), el mismo que usa el nodo
 *     `branch`: el primero, en orden, que se cumple; si ninguno, "Si no";
 *   - cada condicion la evalua `evaluateGroupDetailed` (via `pickPath`).
 * Lo unico propio es DE DONDE salen los valores: aca, de un mapa que arma quien
 * llama (una respuesta real o lo que la persona cargo a mano).
 *
 *   - Un campo que esta en el mapa se evalua con ese valor (`null` = vacio).
 *   - `answer.*` que NO esta en el mapa = la pregunta ya no existe (igual que
 *     el nodo real con la version con la que se respondio): no se cumple.
 *   - Cualquier otro campo que no esta (algo de un paso anterior, del contacto,
 *     de una venta...) = "sin dato en la prueba": no se cumple, y se dice.
 *
 * Los caminos anidados se siguen por el camino que TOMA: lo que cuelga de un
 * camino que no se tomaria no se explica (nunca se llegaria ahi).
 */

import {
  MissingFieldError,
  describeCondition,
  pickPath,
  type BranchCondition,
  type CheckResult,
  type ConditionFieldSpec,
  type EvalOptions,
  type FieldResolver,
  type FieldValue,
} from "@/lib/flow-engine/condition-eval";
import { BRANCH_ELSE_HANDLE, BRANCH_ELSE_LABEL } from "@/lib/flow-engine/branch-paths";
import { pathDisplayLabel } from "./branch-edit";
import type { BranchStep, Step, StepTree } from "./step-tree";

/** Los valores de prueba por ruta de campo. `null` o `undefined` = el campo existe y esta vacio. */
export type TestValues = Record<string, FieldValue>;

/** Lo que paso con una condicion, en una palabra. */
export type CheckStatus = "pass" | "fail" | "no_data" | "missing";

export interface ConditionExplanation {
  field: string;
  /** "Facturación es «Más de USD 10.000»" (sin la marca). */
  text: string;
  status: CheckStatus;
  ok: boolean;
  /** Por que no se pudo evaluar, en palabras ("sin dato en la prueba"). Solo con `no_data` y `missing`. */
  reason?: string;
  /** "Facturación es «Más de USD 10.000» ✓". */
  line: string;
}

export interface PathExplanation {
  id: string;
  label: string;
  logic: "and" | "or";
  passed: boolean;
  conditions: ConditionExplanation[];
}

export interface BranchExplanation {
  stepId: string;
  /** El nombre del nodo ("Según facturación"), o "Condiciones". */
  name: string;
  /** El camino que toma, o `else` (el id de "Si no"). */
  takenPathId: string;
  takenLabel: string;
  /** Va por "Si no". */
  isElse: boolean;
  /** "Iría por «Facturación alta»" / "Ningún camino se cumple: iría por «Si no»". */
  headline: string;
  /** Los caminos mirados, en orden, hasta el que se cumplio (o todos, si fue "Si no"). */
  paths: PathExplanation[];
  /** Para anidados: "dentro de «Facturación alta»". */
  inside?: string;
}

export interface PathsExplanation {
  branches: BranchExplanation[];
}

export const NO_DATA_REASON = "sin dato en la prueba";
export const MISSING_REASON = "la pregunta ya no existe";
const MARK_OK = "✓";
const MARK_FAIL = "✗";

/** Marca de un campo que no se puede leer en la prueba. Distinta de `MissingFieldError` a proposito. */
class NoTestDataError extends Error {
  constructor(public readonly field: string) {
    super(`Sin dato en la prueba: ${field}`);
    this.name = "NoTestDataError";
  }
}

/** El resolver de la prueba: lee del mapa y lanza lo que corresponda (ver arriba). */
export function testResolver(values: TestValues): FieldResolver {
  return (field) => {
    if (Object.prototype.hasOwnProperty.call(values, field)) return values[field];
    if (field.startsWith("answer.")) throw new MissingFieldError(field);
    throw new NoTestDataError(field);
  };
}

function specFor(field: string, fields: ConditionFieldSpec[]): ConditionFieldSpec | undefined {
  return fields.find((f) => f.path === field) ?? fields.find((f) => f.argument && field.startsWith(f.path));
}

function explainCondition(condition: BranchCondition, check: CheckResult | undefined, fields: ConditionFieldSpec[]): ConditionExplanation {
  const spec = specFor(condition.field, fields);
  const optionLabels = spec?.options ? Object.fromEntries(spec.options.map((o) => [o.value, o.label])) : undefined;
  const text = describeCondition(condition, { fieldLabel: spec?.label, optionLabels });

  // `missing` = MissingFieldError; `error` sin `missing` = cualquier otro error de lectura = sin dato.
  const status: CheckStatus = !check ? "no_data" : check.missing ? "missing" : check.error ? "no_data" : check.ok ? "pass" : "fail";
  const ok = status === "pass";
  const reason = status === "missing" ? MISSING_REASON : status === "no_data" ? NO_DATA_REASON : undefined;
  const mark = ok ? MARK_OK : MARK_FAIL;
  return { field: condition.field, text, status, ok, ...(reason ? { reason } : {}), line: reason ? `${text} ${mark} (${reason})` : `${text} ${mark}` };
}

function explainBranch(step: BranchStep, resolve: FieldResolver, fields: ConditionFieldSpec[], options: EvalOptions, inside?: string): BranchExplanation {
  const pick = pickPath(step.paths, resolve, options);
  const paths: PathExplanation[] = pick.evaluated.map((entry, index) => {
    const path = step.paths[index];
    return {
      id: path.id,
      label: pathDisplayLabel(path, index),
      logic: path.logic === "or" ? "or" : "and",
      passed: entry.passed,
      conditions: (Array.isArray(path.conditions) ? path.conditions : []).map((condition, i) => explainCondition(condition, entry.checks[i], fields)),
    };
  });

  const name = typeof step.data.label === "string" && step.data.label.trim() !== "" ? step.data.label.trim() : "Condiciones";
  const isElse = pick.path === null;
  const takenLabel = pick.path ? pathDisplayLabel(pick.path, pick.index) : BRANCH_ELSE_LABEL;
  return {
    stepId: step.id,
    name,
    takenPathId: pick.path?.id ?? BRANCH_ELSE_HANDLE,
    takenLabel,
    isElse,
    headline: isElse ? `Ningún camino se cumple: iría por «${BRANCH_ELSE_LABEL}»` : `Iría por «${takenLabel}»`,
    paths,
    ...(inside ? { inside } : {}),
  };
}

/**
 * Explica, para cada nodo Condiciones al que se llegaria, por que camino iria.
 * En orden de lectura; los anidados aparecen despues de su padre.
 *
 * @param tree   el arbol tal cual esta en pantalla (puede tener cambios sin guardar)
 * @param values los valores de prueba por ruta de campo
 * @param fields el catalogo de campos, solo para nombrarlos ("Facturación") y mostrar las opciones con su etiqueta
 */
export function explainPaths(tree: StepTree, values: TestValues, fields: ConditionFieldSpec[] = [], options: EvalOptions = {}): PathsExplanation {
  const resolve = testResolver(values);
  const branches: BranchExplanation[] = [];

  const walk = (steps: Step[], inside?: string) => {
    for (const step of steps) {
      if (step.kind === "gate") {
        // El "Si" plano de siempre no se explica (sus campos son del formato viejo): lo que tiene adentro se sigue mirando.
        walk(step.steps, inside);
      } else if (step.kind === "branch") {
        const explained = explainBranch(step, resolve, fields, options, inside);
        branches.push(explained);
        const index = step.paths.findIndex((p) => p.id === explained.takenPathId);
        walk(index >= 0 ? step.paths[index].steps : step.otherwise, `dentro de «${explained.takenLabel}»`);
      }
    }
  };
  walk(tree.steps);
  return { branches };
}

/** ¿Tiene el arbol algun nodo Condiciones? (Si no, "Probar condiciones" no se ofrece.) */
export function hasBranchSteps(tree: StepTree | null): boolean {
  if (!tree) return false;
  const any = (steps: Step[]): boolean => steps.some((s) => s.kind === "branch" || (s.kind === "gate" && any(s.steps)));
  return any(tree.steps);
}
