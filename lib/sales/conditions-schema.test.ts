import { describe, expect, it } from "vitest";
import { CONDITION_OPERATORS, EMPTY_CONDITION_TREE, conditionTreeSchema, conditionUseful, readConditionTree, serializeConditionTree } from "./conditions-schema";

const FIELDS = ["last_source", "first_combined", "last_combined", "country", "has_email"];

describe("conditionUseful", () => {
  it("campo fuera de la lista → no sirve", () => {
    expect(conditionUseful({ field: "email", operator: "is", value: "a@b.c" }, FIELDS)).toBe(false);
  });
  it("operador desconocido → no sirve", () => {
    expect(conditionUseful({ field: "country", operator: "regex", value: "x" }, FIELDS)).toBe(false);
  });
  it("«está vacío» sin valor → sirve igual", () => {
    expect(conditionUseful({ field: "last_source", operator: "is_empty", value: "" }, FIELDS)).toBe(true);
  });
  it("«contiene» sin valor → fila a medio llenar, no sirve", () => {
    expect(conditionUseful({ field: "last_source", operator: "contains", value: "   " }, FIELDS)).toBe(false);
  });
  it("los siete operadores del plano", () => {
    expect([...CONDITION_OPERATORS]).toEqual(["is", "is_not", "contains", "not_contains", "starts_with", "is_empty", "is_not_empty"]);
  });
});

describe("serializeConditionTree", () => {
  it("sin condiciones → no guarda nada", () => {
    expect(serializeConditionTree(EMPTY_CONDITION_TREE, FIELDS)).toBeUndefined();
  });

  it("filas a medio llenar → se descartan y no ensucian lo guardado", () => {
    const out = serializeConditionTree(
      {
        rootConjunction: "and",
        conditions: [
          { field: "country", operator: "is", value: "CR" },
          { field: "", operator: "contains", value: "" },
        ],
        groups: [{ conjunction: "or", conditions: [{ field: "last_source", operator: "contains", value: "" }] }],
      },
      FIELDS,
    );
    expect(out?.conditions).toHaveLength(1);
    expect(out?.groups).toHaveLength(0);
  });

  it("grupos con O → se conservan con su conjunción", () => {
    const out = serializeConditionTree(
      {
        rootConjunction: "or",
        conditions: [],
        groups: [{ conjunction: "or", conditions: [{ field: "first_combined", operator: "contains", value: "ig" }, { field: "last_combined", operator: "contains", value: "fb" }] }],
      },
      FIELDS,
    );
    expect(out?.rootConjunction).toBe("or");
    expect(out?.groups[0].conjunction).toBe("or");
    expect(out?.groups[0].conditions).toHaveLength(2);
  });
});

describe("readConditionTree", () => {
  it("configuración vieja o rota → arranca vacío, no explota", () => {
    expect(readConditionTree(undefined)).toEqual(EMPTY_CONDITION_TREE);
    expect(readConditionTree(null)).toEqual(EMPTY_CONDITION_TREE);
    expect(readConditionTree("raro")).toEqual(EMPTY_CONDITION_TREE);
    expect(readConditionTree({ conditions: "no", groups: 3 })).toEqual(EMPTY_CONDITION_TREE);
  });

  it("lo guardado se vuelve a leer igual → ida y vuelta sin pérdidas", () => {
    const guardado = {
      rootConjunction: "and" as const,
      conditions: [{ field: "country", operator: "is", value: "CR" }],
      groups: [{ conjunction: "or" as const, conditions: [{ field: "last_source", operator: "contains", value: "ig" }] }],
    };
    expect(serializeConditionTree(readConditionTree(guardado), FIELDS)).toEqual(guardado);
  });
});

describe("conditionTreeSchema (Zod)", () => {
  it("acepta un árbol válido y rechaza operador o conjunción inventados", () => {
    expect(conditionTreeSchema.safeParse({ rootConjunction: "or", conditions: [{ field: "country", operator: "is", value: "CR" }], groups: [] }).success).toBe(true);
    expect(conditionTreeSchema.safeParse({ rootConjunction: "xor", conditions: [], groups: [] }).success).toBe(false);
    expect(conditionTreeSchema.safeParse({ rootConjunction: "and", conditions: [{ field: "a", operator: "greater_than", value: "1" }], groups: [] }).success).toBe(false);
  });
});
