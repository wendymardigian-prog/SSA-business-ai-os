/**
 * Que se puede comparar de un formulario en un camino condicional
 * ("Condiciones"), y como se lee cada valor. PURO: sin base ni React.
 *
 *   answer.<clave>          cada pregunta, con SU tipo (la ruta es la misma que
 *                           `{{answer.<clave>}}`: los guiones pasan a guion bajo)
 *   form.name               el nombre del formulario
 *   submission.score        el puntaje (solo encuestas)
 *   submission.nps_category promotor / pasivo / detractor (solo encuestas)
 *
 * Con varios formularios en el disparador solo se ofrecen las preguntas que
 * tienen la misma clave y el mismo tipo en TODOS (`commonFields`): si no, la
 * condicion querria decir cosas distintas segun el formulario. Sin formularios
 * elegidos ("cualquiera") no se ofrece ninguna pregunta.
 */
import type { ConditionFieldSpec, FieldValue } from "@/lib/flow-engine/condition-eval";
import { MissingFieldError } from "@/lib/flow-engine/condition-eval";
import type { FormField, FormFieldType } from "@/lib/forms/fields";
import { NPS_CATEGORY_LABELS } from "@/lib/forms/survey";
import { commonFields, type FormWithFields } from "./trigger-config";
import { answersForConditions } from "./triggers";
import { variableKey } from "./variables";

export const FORM_GROUP = "Del formulario";

type ConditionType = ConditionFieldSpec["type"];

/** El tipo de comparacion de cada tipo de pregunta. Los archivos y los ocultos ya vienen afuera. */
export function conditionTypeOfField(type: FormFieldType): ConditionType {
  switch (type) {
    case "number":
    case "rating":
    case "nps":
      return "number";
    case "single_select":
      return "single_select";
    case "multi_select":
      return "multi_select";
    case "date":
      return "date";
    case "consent":
      return "boolean";
    default:
      return "text";
  }
}

/** La ruta de una pregunta en las condiciones. */
export function answerPath(fieldKey: string): string {
  return `answer.${variableKey(fieldKey)}`;
}

function specOfField(field: FormField): ConditionFieldSpec {
  const type = conditionTypeOfField(field.type);
  return {
    path: answerPath(field.key),
    label: field.label || field.key,
    type,
    ...(type === "single_select" || type === "multi_select" ? { options: (field.options ?? []).map((o) => ({ value: o, label: o })) } : {}),
    group: FORM_GROUP,
  };
}

/**
 * Los campos que aporta un trigger de formulario.
 *
 * @param type  el tipo del trigger (`form_submitted`, `survey_answered`, `contract_signed`)
 * @param forms los formularios a los que aplica, con los campos de su version publicada
 */
export function formVariableSchema(type: string, forms: FormWithFields[]): ConditionFieldSpec[] {
  const out: ConditionFieldSpec[] = [{ path: "form.name", label: "Nombre del formulario", type: "text", group: FORM_GROUP }];

  if (type === "survey_answered") {
    out.push(
      { path: "submission.score", label: "Puntaje de la encuesta", type: "number", group: FORM_GROUP },
      {
        path: "submission.nps_category",
        label: "Categoría NPS",
        type: "single_select",
        options: (Object.keys(NPS_CATEGORY_LABELS) as Array<keyof typeof NPS_CATEGORY_LABELS>).map((value) => ({ value, label: NPS_CATEGORY_LABELS[value] })),
        group: FORM_GROUP,
      },
    );
  }

  for (const field of commonFields(forms)) out.push(specOfField(field));
  return out;
}

// ------------------------------------------------------------
// Leer el valor de una respuesta
// ------------------------------------------------------------

export interface AnswerSource {
  /** Las preguntas de la version del formulario con la que se respondio. */
  fields: Array<Pick<FormField, "key">>;
  /** Clave de la pregunta -> `{ value }`, como lo guarda la base. */
  answers: Record<string, { value?: unknown } | undefined> | null | undefined;
}

/**
 * El valor de `answer.<clave>` con su tipo real (un numero es un numero, una
 * seleccion multiple es una lista).
 *
 *   - La pregunta NO esta en la version con la que se respondio -> lanza
 *     `MissingFieldError` ("la pregunta ya no existe"): la condicion no se cumple.
 *   - Esta pero no se respondio -> `undefined` (vacia: `is_empty` se cumple).
 *   - Archivos u otros valores raros -> `undefined`, igual que en el filtro del disparador.
 */
export function answerValueOf(path: string, source: AnswerSource): FieldValue {
  const wanted = path.startsWith("answer.") ? path.slice("answer.".length) : path;
  const field = source.fields.find((f) => variableKey(f.key) === wanted);
  if (!field) throw new MissingFieldError(path);
  return answersForConditions(source.answers)[field.key] as FieldValue;
}
