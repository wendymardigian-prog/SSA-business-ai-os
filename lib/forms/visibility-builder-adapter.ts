/**
 * Traduce entre el formato guardado de las reglas de visibilidad de Formularios
 * (`VisibilityConfig`: la visibilidad de un campo y el "Solo si…" del
 * disparador) y el modelo comun del constructor de condiciones
 * (`lib/automations/condition-builder-model.ts`). PURO.
 *
 * El formato guardado NO cambia: lo que sale es exactamente un `VisibilityConfig`
 * (`fieldKey`, `operator`, `value`, `conjunction`...), sin claves de mas. Asi
 * `lib/forms/visibility.ts` y `answer_conditions` siguen leyendo lo de siempre.
 */

import type { BuilderCondition, BuilderField, BuilderValue, ValueSlot } from "@/lib/automations/condition-builder-model";
import type { FormFieldType } from "./fields";
import { operatorsFor, valueInputFor } from "./visibility-ui";
import type { Condition, ConditionOperator, VisibilityConfig } from "./visibility-types";

/** Un campo del formulario sobre el que se puede armar una condicion (el que usa `VisibilityRuleBuilder`). */
export interface ConditionSource {
  key: string;
  label: string;
  type: FormFieldType;
  options?: string[];
}

/** Lo que se pide del valor, segun el tipo del campo y el operador (la misma regla de siempre: `valueInputFor`). */
function slotsFor(type: FormFieldType, operator: string): ValueSlot[] {
  const input = valueInputFor(type, operator as ConditionOperator);
  switch (input) {
    case "none":
      return [];
    case "options":
      return [{ kind: "options", target: "value", label: "Valor" }];
    case "boolean":
      return [{ kind: "boolean", target: "value", label: "Valor" }];
    case "number":
      return [{ kind: "number", target: "value", label: "Valor" }];
    case "date":
      return [{ kind: "date", target: "value", label: "Valor" }];
    default:
      return [{ kind: "text", target: "value", label: "Valor", ...(operator === "includes_any" ? { placeholder: "a, b, c" } : {}) }];
  }
}

export function fieldFromSource(source: ConditionSource): BuilderField {
  return {
    path: source.key,
    label: source.label,
    // El tipo del constructor no se usa: los operadores y lo que se pide los trae el campo.
    type: "text",
    ...(source.options ? { options: source.options.map((o) => ({ value: o, label: o })) } : {}),
    operators: operatorsFor(source.type).map((o) => ({ id: o.value, label: o.label })),
    slots: (operator) => slotsFor(source.type, operator),
  };
}

const toBuilder = (c: Condition): BuilderCondition => ({
  ...(c.id !== undefined ? { id: c.id } : {}),
  field: c.fieldKey,
  operator: c.operator,
  value: c.value,
  // Cualquier tipo sirve: lo importante es que NO se lea como una condicion del nodo viejo.
  valueType: "text",
});

const fromBuilder = (c: BuilderCondition): Condition => ({
  ...(c.id !== undefined ? { id: c.id } : {}),
  fieldKey: c.field,
  operator: c.operator as ConditionOperator,
  value: c.value ?? "",
});

export function visibilityToBuilder(config: VisibilityConfig | undefined): BuilderValue {
  if (!config) return { rootConjunction: "and", conditions: [], groups: [] };
  return {
    rootConjunction: config.rootConjunction,
    conditions: config.conditions.map(toBuilder),
    groups: config.groups.map((g) => ({ ...(g.id !== undefined ? { id: g.id } : {}), conjunction: g.conjunction, conditions: g.conditions.map(toBuilder) })),
  };
}

/** De vuelta al formato guardado. Sin ninguna condicion es `undefined` (vacio = sin regla, como siempre). */
export function builderToVisibility(value: BuilderValue): VisibilityConfig | undefined {
  const empty = value.conditions.length === 0 && value.groups.every((g) => g.conditions.length === 0);
  if (empty) return undefined;
  return {
    rootConjunction: value.rootConjunction,
    conditions: value.conditions.map(fromBuilder),
    groups: value.groups
      .filter((g) => g.conditions.length > 0)
      .map((g) => ({ ...(g.id !== undefined ? { id: g.id } : {}), conjunction: g.conjunction, conditions: g.conditions.map(fromBuilder) })),
  };
}
