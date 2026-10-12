import { describe, it, expect } from "vitest";
import {
  blankCondition,
  changeField,
  changeOperator,
  defaultOperatorOf,
  isLegacyCondition,
  isOperatorValid,
  operatorsOf,
  slotsOf,
} from "@/lib/automations/condition-builder-model";
import { evaluateVisibility } from "./visibility";
import { operatorsFor, valueInputFor, defaultOperatorFor, isOperatorValidFor } from "./visibility-ui";
import { builderToVisibility, fieldFromSource, visibilityToBuilder, type ConditionSource } from "./visibility-builder-adapter";
import type { FormFieldType } from "./fields";
import { CONDITION_OPERATORS, type VisibilityConfig } from "./visibility-types";

const TYPES: FormFieldType[] = ["short_text", "long_text", "email", "phone", "hidden", "social", "number", "rating", "nps", "date", "single_select", "multi_select", "consent", "file"];
const source = (type: FormFieldType): ConditionSource => ({ key: "campo", label: "Campo", type, options: ["A", "B"] });

describe("el formato guardado de Formularios no cambia", () => {
  const config: VisibilityConfig = {
    rootConjunction: "or",
    conditions: [
      { id: "c_1", fieldKey: "edad", operator: "gte", value: "18" },
      { id: "c_2", fieldKey: "pais", operator: "is_empty", value: "" },
    ],
    groups: [{ id: "g_1", conjunction: "and", conditions: [{ id: "c_3", fieldKey: "plan", operator: "includes_any", value: "a, b" }] }],
  };

  it("ida y vuelta devuelve exactamente lo mismo", () => {
    expect(builderToVisibility(visibilityToBuilder(config))).toEqual(config);
  });

  it("sin id tampoco inventa claves", () => {
    const bare: VisibilityConfig = { rootConjunction: "and", conditions: [{ fieldKey: "x", operator: "is", value: "1" }], groups: [] };
    const back = builderToVisibility(visibilityToBuilder(bare))!;
    expect(back).toEqual(bare);
    expect(Object.keys(back.conditions[0]).sort()).toEqual(["fieldKey", "operator", "value"]);
  });

  it("sin condiciones es undefined (vacio = sin regla) y los grupos vacios se sacan", () => {
    expect(builderToVisibility(visibilityToBuilder(undefined))).toBeUndefined();
    expect(builderToVisibility({ rootConjunction: "and", conditions: [], groups: [{ conjunction: "or", conditions: [] }] })).toBeUndefined();
    const withEmptyGroup = builderToVisibility({ rootConjunction: "and", conditions: visibilityToBuilder(config).conditions, groups: [{ conjunction: "or", conditions: [] }] })!;
    expect(withEmptyGroup.groups).toEqual([]);
  });

  it("lo que sale lo entiende el evaluador de siempre", () => {
    const back = builderToVisibility(visibilityToBuilder(config))!;
    expect(evaluateVisibility(back, { edad: "20", pais: "", plan: "a" })).toBe(true);
  });

  it("'contiene' de Formularios NO se confunde con el 'contiene' del nodo viejo", () => {
    const [c] = visibilityToBuilder({ rootConjunction: "and", conditions: [{ fieldKey: "x", operator: "contains", value: "a" }], groups: [] }).conditions;
    expect(isLegacyCondition(c)).toBe(false);
  });
});

describe("el constructor general ofrece lo mismo que ofrecia el de Formularios", () => {
  it.each(TYPES)("%s: mismos operadores, en el mismo orden", (type) => {
    const field = fieldFromSource(source(type));
    expect(operatorsOf(field)).toEqual(operatorsFor(type).map((o) => ({ id: o.value, label: o.label })));
    expect(defaultOperatorOf(field)).toBe(defaultOperatorFor(type));
  });

  it.each(TYPES)("%s: pide el mismo tipo de valor para cada operador", (type) => {
    const field = fieldFromSource(source(type));
    for (const operator of CONDITION_OPERATORS) {
      const input = valueInputFor(type, operator);
      const slots = slotsOf(field, operator);
      if (input === "none") expect(slots, `${type}/${operator}`).toEqual([]);
      else {
        expect(slots, `${type}/${operator}`).toHaveLength(1);
        expect(slots[0].kind, `${type}/${operator}`).toBe(input);
      }
      expect(isOperatorValid(field, operator), `${type}/${operator}`).toBe(isOperatorValidFor(type, operator));
    }
  });

  it("una seleccion pide un desplegable con las opciones del formulario", () => {
    const field = fieldFromSource(source("single_select"));
    expect(slotsOf(field, "is")[0].kind).toBe("options");
    expect(field.options).toEqual([{ value: "A", label: "A" }, { value: "B", label: "B" }]);
  });

  it("'incluye alguna de' sigue siendo texto separado por comas", () => {
    const slot = slotsOf(fieldFromSource(source("single_select")), "includes_any")[0];
    expect(slot).toMatchObject({ kind: "text", placeholder: "a, b, c" });
  });

  it("cambiar de campo conserva el operador si sigue valiendo, como antes", () => {
    const number = fieldFromSource(source("number"));
    const text = fieldFromSource(source("short_text"));
    const start = { ...blankCondition(number), operator: "is", valueType: "text" as const };
    expect(changeField(start, text).operator).toBe("is");
    expect(changeField({ ...start, operator: "gt" }, text).operator).toBe("is");
  });

  it("un operador sin valor limpia el valor, como antes", () => {
    const field = fieldFromSource(source("short_text"));
    expect(changeOperator({ ...blankCondition(field), operator: "is", value: "x" }, field, "is_empty").value).toBe("");
  });
});
