import { describe, it, expect } from "vitest";
import { availableConditionFields } from "@/lib/flow-engine/condition-catalog";
import { evaluateCondition } from "@/lib/flow-engine/condition-eval";
import { formVariableSchema } from "@/lib/forms/automation/variable-schema";
import type { FormField } from "@/lib/forms/fields";
import {
  blankCondition,
  builderFieldFromSpec,
  changeField,
  changeOperator,
  conditionProblem,
  countConditions,
  defaultOperatorOf,
  describeBuilderCondition,
  fieldOfCondition,
  isLegacyCondition,
  isOperatorValid,
  offeredFields,
  operatorsOf,
  optionsWithCurrent,
  pruneGroups,
  recognizedFields,
  setArgument,
  slotsOf,
  type BuilderField,
} from "./condition-builder-model";

const FACT = ["Menos de USD 1.000", "USD 1.000 a USD 10.000", "Más de USD 10.000"];
const form: FormField[] = [
  { id: "1", key: "facturacion", type: "single_select", label: "Facturación", required: true, options: FACT },
  { id: "2", key: "edad", type: "number", label: "Edad", required: false },
];
const groups = availableConditionFields({
  triggerSchema: formVariableSchema("form_submitted", [{ id: "f1", fields: form }]),
  tags: [{ name: "vip" }],
  sequences: [{ id: "s1", name: "Bienvenida" }],
  customFields: [{ slug: "alta", name: "Fecha de alta", type: "date" }],
});
const offered = offeredFields(groups);
const byPath = (path: string) => offered.find((f) => f.path === path)!;

describe("operadores y que se pide", () => {
  it("una seleccion pide un desplegable con sus opciones, nunca texto", () => {
    const fact = byPath("answer.facturacion");
    expect(operatorsOf(fact).map((o) => o.id)).toEqual(["is", "is_not", "is_any_of", "is_empty"]);
    expect(slotsOf(fact, "is")).toEqual([{ kind: "options", target: "value", label: "Valor" }]);
    expect(slotsOf(fact, "is_any_of")).toEqual([{ kind: "options-multi", target: "values", label: "Opciones" }]);
    expect(slotsOf(fact, "is_empty")).toEqual([]);
    expect(fact.options).toHaveLength(3);
  });

  it("las selecciones multiples (tags) tambien: incluye → una opcion; incluye alguna de → varias", () => {
    const tags = byPath("contact.tags");
    expect(slotsOf(tags, "includes")[0].kind).toBe("options");
    expect(slotsOf(tags, "includes_any")[0].kind).toBe("options-multi");
  });

  it("numero: 'entre' pide dos; fecha: 'en los ultimos' pide dias", () => {
    expect(slotsOf(byPath("answer.edad"), "between").map((s) => [s.kind, s.target])).toEqual([["number", "value"], ["number", "value2"]]);
    expect(slotsOf(byPath("alta"), "between").map((s) => s.kind)).toEqual(["date", "date"]);
    expect(slotsOf(byPath("alta"), "within_last_days")).toEqual([{ kind: "days", target: "value", label: "Cantidad de días" }]);
  });

  it("sí/no no pide valor: el operador lo dice", () => {
    const bool = builderFieldFromSpec({ path: "x", label: "X", type: "boolean" });
    expect(operatorsOf(bool).map((o) => o.id)).toEqual(["is_true", "is_false"]);
    expect(slotsOf(bool, "is_true")).toEqual([]);
  });

  it("quien trae sus propios operadores (Formularios) los pisa", () => {
    const own: BuilderField = {
      path: "k",
      label: "K",
      type: "text",
      operators: [{ id: "includes_any", label: "incluye alguna de" }],
      slots: () => [{ kind: "text", target: "value", label: "Valor" }],
    };
    expect(operatorsOf(own).map((o) => o.id)).toEqual(["includes_any"]);
    expect(slotsOf(own, "includes_any")[0].kind).toBe("text");
    expect(defaultOperatorOf(own)).toBe("includes_any");
  });

  it("offeredFields saca los campos viejos (tag:, sequence:) y recognizedFields los conserva", () => {
    expect(offered.some((f) => f.path === "tag:")).toBe(false);
    expect(recognizedFields(groups).some((f) => f.path === "tag:")).toBe(true);
  });
});

describe("armar y cambiar una condicion", () => {
  it("una condicion en blanco trae el tipo del campo y su primer operador", () => {
    const c = blankCondition(byPath("answer.facturacion"), () => 0.5);
    expect(c).toMatchObject({ field: "answer.facturacion", operator: "is", valueType: "single_select", value: "" });
    expect(c.id).toMatch(/^c_/);
  });

  it("sin campos que ofrecer, queda sin campo (el constructor avisa)", () => {
    expect(blankCondition(undefined).field).toBe("");
  });

  it("cambiar de campo borra el valor y arregla el operador si ya no vale", () => {
    const start = { ...blankCondition(byPath("answer.facturacion")), operator: "is_any_of", values: [FACT[0]] };
    const next = changeField(start, byPath("answer.edad"));
    expect(next).toMatchObject({ field: "answer.edad", valueType: "number", operator: "eq", value: "" });
    expect(next).not.toHaveProperty("values");
    expect(next.id).toBe(start.id);
  });

  it("cambiar a otro campo del MISMO tipo conserva el operador", () => {
    const start = { ...blankCondition(byPath("answer.edad")), operator: "gt", value: "5" };
    const other = builderFieldFromSpec({ path: "presupuesto", label: "Presupuesto", type: "number" });
    expect(changeField(start, other)).toMatchObject({ operator: "gt", value: "" });
  });

  it("cambiar el operador descarta lo que la nueva forma no pide", () => {
    const edad = byPath("answer.edad");
    const between = { ...blankCondition(edad), operator: "between", value: "10", value2: "20" };
    const gt = changeOperator(between, edad, "gt");
    expect(gt).toMatchObject({ operator: "gt", value: "10" });
    expect(gt).not.toHaveProperty("value2");
    expect(changeOperator(gt, edad, "is_empty")).toMatchObject({ operator: "is_empty", value: "" });
    const multi = changeOperator({ ...blankCondition(byPath("answer.facturacion")), value: FACT[0] }, byPath("answer.facturacion"), "is_any_of");
    expect(multi).toMatchObject({ operator: "is_any_of", value: "", values: [] });
  });

  it("el argumento (secuencia, nombre de un tag) se pega al prefijo", () => {
    const sale = builderFieldFromSpec({ path: "sale_utm:", label: "UTM de la venta", type: "text", argument: { kind: "text", label: "Cuál" } });
    const c = setArgument(blankCondition(sale), sale, " source ");
    expect(c.field).toBe("sale_utm:source");
    expect(fieldOfCondition([sale], "sale_utm:source")).toBe(sale);
  });
});

describe("revisar", () => {
  it("una condicion completa no tiene problemas; la vacia, si", () => {
    const fact = byPath("answer.facturacion");
    expect(conditionProblem(blankCondition(fact), fact)).toMatch(/opción/);
    expect(conditionProblem({ ...blankCondition(fact), value: FACT[2] }, fact)).toBeNull();
    expect(conditionProblem({ ...blankCondition(fact), operator: "is_empty" }, fact)).toBeNull();
    expect(conditionProblem({ ...blankCondition(fact), operator: "is_any_of", values: [] }, fact)).toMatch(/al menos una/);
  });

  it("un numero tiene que ser un numero y 'entre' pide los dos", () => {
    const edad = byPath("answer.edad");
    expect(conditionProblem({ ...blankCondition(edad), operator: "gt", value: "abc" }, edad)).toMatch(/número/);
    expect(conditionProblem({ ...blankCondition(edad), operator: "between", value: "1" }, edad)).toBeTruthy();
    expect(conditionProblem({ ...blankCondition(edad), operator: "between", value: "1", value2: "5" }, edad)).toBeNull();
  });

  it("un campo que ya no existe es un problema; una condicion vieja no", () => {
    expect(conditionProblem({ field: "answer.borrada", operator: "is", valueType: "text", value: "x" }, undefined)).toBe("Elegí un campo.");
    const legacy = { field: "tag:vip", operator: "equals", value: "true" };
    expect(isLegacyCondition(legacy)).toBe(true);
    expect(conditionProblem(legacy, undefined)).toBeNull();
  });

  it("una secuencia sin elegir es un problema; un argumento marcado (opcional) no", () => {
    const seq = builderFieldFromSpec({ path: "sequence_ever:", label: "Estuvo en la secuencia", type: "boolean", argument: { kind: "sequence" } });
    expect(conditionProblem({ ...blankCondition(seq) }, seq)).toMatch(/secuencia/);
    const opt = builderFieldFromSpec({ path: "has_active_sale:", label: "Venta activa", type: "boolean", argument: { kind: "text", label: "Producto (opcional)" } });
    expect(conditionProblem(blankCondition(opt), opt)).toBeNull();
  });

  it("la frase usa el nombre del campo y la etiqueta de las opciones", () => {
    const fields = recognizedFields(groups);
    const text = describeBuilderCondition({ field: "answer.facturacion", operator: "is", valueType: "single_select", value: FACT[2] }, fields);
    expect(text).toBe(`Facturación es «${FACT[2]}»`);
  });

  it("una opcion guardada que ya no existe se sigue mostrando, marcada", () => {
    const list = optionsWithCurrent([{ value: "vip", label: "vip" }], ["vip", "viejo"]);
    expect(list).toEqual([{ value: "vip", label: "vip" }, { value: "viejo", label: "viejo", missing: true }]);
  });

  it("contar y limpiar grupos", () => {
    const value = { rootConjunction: "and" as const, conditions: [blankCondition(undefined)], groups: [{ conjunction: "or" as const, conditions: [] }, { conjunction: "or" as const, conditions: [blankCondition(undefined)] }] };
    expect(countConditions(value)).toBe(2);
    expect(pruneGroups(value).groups).toHaveLength(1);
  });
});

describe("lo que arma el constructor lo evalua el motor", () => {
  it("una condicion completa de cada tipo se cumple con el valor que corresponde", () => {
    const fact = byPath("answer.facturacion");
    const c = { ...blankCondition(fact), value: FACT[2] };
    expect(evaluateCondition(c, FACT[2])).toBe(true);
    expect(evaluateCondition(c, FACT[0])).toBe(false);
    const edad = byPath("answer.edad");
    expect(evaluateCondition({ ...changeOperator(blankCondition(edad), edad, "gte"), value: "30" }, "35")).toBe(true);
  });

  it("isOperatorValid distingue los operadores de cada tipo", () => {
    expect(isOperatorValid(byPath("answer.edad"), "gt")).toBe(true);
    expect(isOperatorValid(byPath("answer.facturacion"), "gt")).toBe(false);
  });
});
