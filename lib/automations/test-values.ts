/**
 * De donde salen los valores de "Probar condiciones". PURO.
 *
 * Dos origenes, los dos terminan en el mismo `TestValues` (ruta del campo ->
 * valor) que entiende `explainPaths`:
 *
 *   - una RESPUESTA REAL del formulario: se lee con la definicion de LA VERSION
 *     con la que se respondio (igual que el nodo `branch` real), asi una pregunta
 *     que ya no esta en esa version no aparece y la condicion sobre ella dice
 *     "la pregunta ya no existe";
 *   - lo que la persona CARGA A MANO en un formulario chico armado con los campos
 *     del disparador.
 */

import type { ConditionFieldSpec, FieldValue } from "@/lib/flow-engine/condition-eval";
import type { FormField } from "@/lib/forms/fields";
import { answerPath, answerValueOf, type AnswerSource } from "@/lib/forms/automation/variable-schema";
import type { TestValues } from "./explain-paths";
import type { ConditionCatalogInputs } from "./condition-catalog-inputs";
import { allSteps, type StepTree } from "./step-tree";
import { conditionGroupsFor } from "./step-tree-edit";

export interface SubmissionForTest {
  /** Las preguntas de la version con la que se respondio. */
  fields: Array<Pick<FormField, "key">>;
  answers: AnswerSource["answers"];
  formName: string;
  /** Solo encuestas. */
  score?: number | null;
  npsCategory?: string | null;
}

/**
 * Los valores de una respuesta real. Cada pregunta de la version, con su valor
 * real (un numero, una lista); sin responder = `null` (vacia). `form.name`
 * siempre, y el puntaje y la categoria NPS solo si la respuesta los tiene (si
 * no, la condicion dice "sin dato en la prueba" y no inventa un cero).
 */
export function testValuesFromSubmission(input: SubmissionForTest): TestValues {
  const values: TestValues = { "form.name": input.formName };
  const source: AnswerSource = { fields: input.fields, answers: input.answers };
  for (const field of input.fields) {
    const path = answerPath(field.key);
    const value = answerValueOf(path, source);
    values[path] = value === undefined ? null : value;
  }
  if (input.score !== null && input.score !== undefined) values["submission.score"] = input.score;
  if (input.npsCategory) values["submission.nps_category"] = input.npsCategory;
  return values;
}

// ------------------------------------------------------------
// A mano
// ------------------------------------------------------------

/** Los campos que se piden en el formulario chico: los del disparador (las preguntas, los datos de la reunion...). */
export function manualFields(triggerSchema: ConditionFieldSpec[]): ConditionFieldSpec[] {
  return triggerSchema.filter((f) => !f.argument && !f.legacy);
}

/** Lo que la persona escribio o eligio: texto, o una lista para una seleccion multiple. */
export type ManualInputs = Record<string, string | string[] | undefined>;

/**
 * De lo cargado en pantalla a valores de prueba. Todo campo del formulario chico
 * queda en el mapa: lo que se dejo en blanco es `null` (vacio), no "sin dato", porque
 * la persona SI vio el campo y lo dejo vacio.
 */
export function manualValuesFrom(fields: ConditionFieldSpec[], inputs: ManualInputs): TestValues {
  const values: TestValues = {};
  for (const field of fields) {
    const raw = inputs[field.path];
    values[field.path] = manualValue(field.type, raw);
  }
  return values;
}

function manualValue(type: ConditionFieldSpec["type"], raw: string | string[] | undefined): FieldValue {
  if (type === "multi_select") {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.length > 0 ? list : null;
  }
  const text = Array.isArray(raw) ? raw.join(", ") : (raw ?? "");
  if (text.trim() === "") return null;
  if (type === "boolean") return text === "true" ? true : text === "false" ? false : null;
  // Un numero escrito a mano se deja como texto: el evaluador lo lee como numero (o dice que no lo es).
  return text;
}

// ------------------------------------------------------------
// La lista de respuestas
// ------------------------------------------------------------

/** "12/10/2026, 15:30 · Ana Pérez (ana@ejemplo.com)". */
export function testResponseLabel(input: { whenText: string; name?: string | null; email?: string | null }): string {
  const name = input.name?.trim();
  const email = input.email?.trim();
  const who = name && email ? `${name} (${email})` : name || email || "Sin contacto";
  return `${input.whenText} · ${who}`;
}

// ------------------------------------------------------------
// Nombrar los campos
// ------------------------------------------------------------

/**
 * Todos los campos que el arbol puede nombrar, para escribir "Facturación" en vez
 * de `answer.facturacion`: los de cada nodo Condiciones (lo del servidor mas lo
 * que dejan los pasos de antes), sin repetir ninguna ruta.
 */
export function fieldsOfTree(tree: StepTree, inputs: ConditionCatalogInputs | null): ConditionFieldSpec[] {
  const seen = new Set<string>();
  const out: ConditionFieldSpec[] = [];
  const branches = allSteps(tree).filter((s) => s.kind === "branch");
  // Sin ningun Condiciones igual se nombran los del disparador.
  const ids = branches.length > 0 ? branches.map((b) => b.id) : [tree.trigger.id];
  for (const id of ids) {
    for (const group of conditionGroupsFor(tree, id, inputs)) {
      for (const field of group.fields) {
        if (seen.has(field.path)) continue;
        seen.add(field.path);
        out.push(field);
      }
    }
  }
  return out;
}
