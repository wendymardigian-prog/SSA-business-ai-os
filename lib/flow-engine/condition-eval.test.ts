import { describe, it, expect } from "vitest";
import {
  evaluateCondition,
  evaluateGroup,
  evaluateGroupDetailed,
  pickPath,
  describeCondition,
  describeGroup,
  inferValueType,
  operatorInfo,
  MissingFieldError,
  OPERATORS_BY_TYPE,
  type BranchCondition,
  type BranchPath,
  type ConditionValueType,
  type FieldValue,
} from "./condition-eval";
import { evaluateCondition as evaluateVisibilityCondition } from "@/lib/forms/visibility";
import type { Condition as VisibilityCondition } from "@/lib/forms/visibility-types";
import { LEGACY_OPERATORS } from "./legacy-operators";
import { getConditionOperator } from "./registry/registry";

const NOW = new Date("2026-10-12T15:00:00Z");

const c = (operator: string, valueType: ConditionValueType, rest: Partial<BranchCondition> = {}): BranchCondition => ({ field: "x", operator, valueType, ...rest });
const ev = (cond: BranchCondition, actual: FieldValue) => evaluateCondition(cond, actual, { now: NOW });

describe("texto", () => {
  it("is / is_not ignoran mayusculas y espacios", () => {
    expect(ev(c("is", "text", { value: "Hola" }), "  hola ")).toBe(true);
    expect(ev(c("is", "text", { value: "hola" }), "chau")).toBe(false);
    expect(ev(c("is_not", "text", { value: "hola" }), "chau")).toBe(true);
    expect(ev(c("is_not", "text", { value: "hola" }), "HOLA")).toBe(false);
  });
  it("sin valor: `is` no se cumple y `is_not` si", () => {
    expect(ev(c("is", "text", { value: "x" }), undefined)).toBe(false);
    expect(ev(c("is_not", "text", { value: "x" }), "")).toBe(true);
  });
  it("contains / not_contains", () => {
    expect(ev(c("contains", "text", { value: "MUNDO" }), "hola mundo")).toBe(true);
    expect(ev(c("contains", "text", { value: "mundo" }), "hola")).toBe(false);
    expect(ev(c("not_contains", "text", { value: "mundo" }), "hola")).toBe(true);
    expect(ev(c("not_contains", "text", { value: "mundo" }), null)).toBe(true);
    expect(ev(c("contains", "text", { value: "a" }), null)).toBe(false);
  });
  it("is_empty / is_not_empty: un texto de solo espacios esta vacio", () => {
    expect(ev(c("is_empty", "text"), "   ")).toBe(true);
    expect(ev(c("is_empty", "text"), null)).toBe(true);
    expect(ev(c("is_empty", "text"), "0")).toBe(false);
    expect(ev(c("is_not_empty", "text"), "a")).toBe(true);
    expect(ev(c("is_not_empty", "text"), "")).toBe(false);
  });
  it("un numero o un booleano se leen como texto", () => {
    expect(ev(c("is", "text", { value: "12" }), 12)).toBe(true);
    expect(ev(c("is", "text", { value: "true" }), true)).toBe(true);
  });
});

describe("numero", () => {
  it('compara el valor, no el texto: "12" > 9 y "12" < "9" como texto no ocurre', () => {
    expect(ev(c("gt", "number", { value: "9" }), "12")).toBe(true);
    expect(ev(c("lt", "number", { value: "9" }), "12")).toBe(false);
    expect(ev(c("gt", "number", { value: "9" }), 12)).toBe(true);
  });
  it("eq / neq / gte / lte", () => {
    expect(ev(c("eq", "number", { value: "5" }), "5.0")).toBe(true);
    expect(ev(c("neq", "number", { value: "5" }), 6)).toBe(true);
    expect(ev(c("neq", "number", { value: "5" }), 5)).toBe(false);
    expect(ev(c("gte", "number", { value: "5" }), 5)).toBe(true);
    expect(ev(c("lte", "number", { value: "5" }), 5)).toBe(true);
    expect(ev(c("gt", "number", { value: "5" }), 5)).toBe(false);
  });
  it("between es inclusivo y no depende del orden de los extremos", () => {
    expect(ev(c("between", "number", { value: "10", value2: "20" }), 10)).toBe(true);
    expect(ev(c("between", "number", { value: "10", value2: "20" }), "20")).toBe(true);
    expect(ev(c("between", "number", { value: "10", value2: "20" }), 21)).toBe(false);
    expect(ev(c("between", "number", { value: "20", value2: "10" }), 15)).toBe(true);
    expect(ev(c("between", "number", { value: "10" }), 15)).toBe(false);
  });
  it('un valor que no es numero ("abc") no cumple NADA numerico, ni "es distinto de"', () => {
    for (const op of ["eq", "neq", "gt", "gte", "lt", "lte"]) {
      expect(ev(c(op, "number", { value: "1" }), "abc"), op).toBe(false);
    }
    expect(ev(c("between", "number", { value: "1", value2: "9" }), "abc")).toBe(false);
  });
  it("un valor vacio no cumple lo numerico, pero is_empty si", () => {
    expect(ev(c("lt", "number", { value: "10" }), "")).toBe(false);
    expect(ev(c("neq", "number", { value: "10" }), undefined)).toBe(false);
    expect(ev(c("is_empty", "number"), "")).toBe(true);
    expect(ev(c("is_empty", "number"), 0)).toBe(false);
    expect(ev(c("is_empty", "number"), "abc")).toBe(false);
  });
  it("un valor de comparacion que no es numero no se cumple", () => {
    expect(ev(c("gt", "number", { value: "mucho" }), 5)).toBe(false);
    expect(ev(c("eq", "number", {}), 5)).toBe(false);
  });
});

describe("seleccion unica", () => {
  it("is / is_not", () => {
    expect(ev(c("is", "single_select", { value: "Crm" }), " crm ")).toBe(true);
    expect(ev(c("is", "single_select", { value: "crm" }), "erp")).toBe(false);
    expect(ev(c("is_not", "single_select", { value: "crm" }), "erp")).toBe(true);
    expect(ev(c("is_not", "single_select", { value: "crm" }), "")).toBe(true);
    expect(ev(c("is", "single_select", { value: "crm" }), null)).toBe(false);
  });
  it("is_any_of: alguna de la lista; una lista vacia no deja pasar a nadie", () => {
    expect(ev(c("is_any_of", "single_select", { values: ["A", "B"] }), "b")).toBe(true);
    expect(ev(c("is_any_of", "single_select", { values: ["A", "B"] }), "c")).toBe(false);
    expect(ev(c("is_any_of", "single_select", { values: [] }), "a")).toBe(false);
    expect(ev(c("is_any_of", "single_select", {}), "a")).toBe(false);
  });
  it("is_empty", () => {
    expect(ev(c("is_empty", "single_select"), "")).toBe(true);
    expect(ev(c("is_empty", "single_select"), "a")).toBe(false);
  });
});

describe("seleccion multiple", () => {
  const mine = ["A", "B"];
  it("includes / not_includes", () => {
    expect(ev(c("includes", "multi_select", { value: "a" }), mine)).toBe(true);
    expect(ev(c("includes", "multi_select", { value: "C" }), mine)).toBe(false);
    expect(ev(c("not_includes", "multi_select", { value: "C" }), mine)).toBe(true);
    expect(ev(c("not_includes", "multi_select", { value: "A" }), mine)).toBe(false);
    expect(ev(c("not_includes", "multi_select", { value: "A" }), [])).toBe(true);
  });
  it("includes_any: [A,B] contra [B,C] -> si; includes_all: [A,B] contra [B,C] -> no", () => {
    expect(ev(c("includes_any", "multi_select", { values: ["B", "C"] }), mine)).toBe(true);
    expect(ev(c("includes_all", "multi_select", { values: ["B", "C"] }), mine)).toBe(false);
    expect(ev(c("includes_all", "multi_select", { values: ["A", "B"] }), mine)).toBe(true);
    expect(ev(c("includes_all", "multi_select", { values: ["a"] }), mine)).toBe(true);
  });
  it("listas vacias en la condicion no se cumplen (una regla a medio armar no deja pasar)", () => {
    expect(ev(c("includes_any", "multi_select", { values: [] }), mine)).toBe(false);
    expect(ev(c("includes_all", "multi_select", { values: [] }), mine)).toBe(false);
  });
  it("is_empty", () => {
    expect(ev(c("is_empty", "multi_select"), [])).toBe(true);
    expect(ev(c("is_empty", "multi_select"), undefined)).toBe(true);
    expect(ev(c("is_empty", "multi_select"), mine)).toBe(false);
  });
  it('un texto "A, B" (variable de texto) se lee como lista', () => {
    expect(ev(c("includes", "multi_select", { value: "b" }), "A, B")).toBe(true);
  });
});

describe("fecha (reloj fijo: 12/10/2026 15:00 UTC)", () => {
  it("before / after comparan por dia", () => {
    expect(ev(c("before", "date", { value: "2026-10-12" }), "2026-10-11")).toBe(true);
    expect(ev(c("before", "date", { value: "2026-10-12" }), "2026-10-12")).toBe(false);
    expect(ev(c("after", "date", { value: "2026-10-12" }), "2026-10-13T08:00:00Z")).toBe(true);
    expect(ev(c("after", "date", { value: "2026-10-12" }), "2026-10-12T23:59:00Z")).toBe(false);
  });
  it("between es inclusivo y no depende del orden", () => {
    expect(ev(c("between", "date", { value: "2026-10-01", value2: "2026-10-31" }), "2026-10-01")).toBe(true);
    expect(ev(c("between", "date", { value: "2026-10-01", value2: "2026-10-31" }), "2026-10-31")).toBe(true);
    expect(ev(c("between", "date", { value: "2026-10-01", value2: "2026-10-31" }), "2026-11-01")).toBe(false);
    expect(ev(c("between", "date", { value: "2026-10-31", value2: "2026-10-01" }), "2026-10-15")).toBe(true);
    expect(ev(c("between", "date", { value: "2026-10-01" }), "2026-10-15")).toBe(false);
  });
  it("within_last_days: en los ultimos N dias; el futuro no cuenta", () => {
    expect(ev(c("within_last_days", "date", { value: "7" }), "2026-10-10")).toBe(true);
    expect(ev(c("within_last_days", "date", { value: "7" }), "2026-10-01")).toBe(false);
    expect(ev(c("within_last_days", "date", { value: "7" }), "2026-10-20")).toBe(false);
    expect(ev(c("within_last_days", "date", { value: "7" }), "2026-10-12T14:00:00Z")).toBe(true);
  });
  it("older_than_days: hace mas de N dias", () => {
    expect(ev(c("older_than_days", "date", { value: "30" }), "2026-08-01")).toBe(true);
    expect(ev(c("older_than_days", "date", { value: "30" }), "2026-10-01")).toBe(false);
    expect(ev(c("older_than_days", "date", { value: "30" }), "2026-12-01")).toBe(false);
  });
  it("sin fecha valida no se cumple nada, salvo is_empty", () => {
    for (const op of ["before", "after", "within_last_days", "older_than_days"]) {
      expect(ev(c(op, "date", { value: "2026-10-12" }), "no es fecha"), op).toBe(false);
    }
    expect(ev(c("is_empty", "date"), "")).toBe(true);
    expect(ev(c("is_empty", "date"), "2026-10-12")).toBe(false);
  });
  it("una condicion de dias con un valor invalido no se cumple", () => {
    expect(ev(c("within_last_days", "date", { value: "pronto" }), "2026-10-12")).toBe(false);
    expect(ev(c("older_than_days", "date", { value: "-3" }), "2026-01-01")).toBe(false);
    expect(ev(c("before", "date", { value: "ayer" }), "2026-10-12")).toBe(false);
  });
  it("sin reloj usa el de ahora (no lanza)", () => {
    expect(evaluateCondition(c("within_last_days", "date", { value: "1" }), new Date().toISOString())).toBe(true);
  });
});

describe("si / no", () => {
  it("is_true / is_false", () => {
    expect(ev(c("is_true", "boolean"), true)).toBe(true);
    expect(ev(c("is_true", "boolean"), "true")).toBe(true);
    expect(ev(c("is_true", "boolean"), "Sí")).toBe(true);
    expect(ev(c("is_false", "boolean"), false)).toBe(true);
    expect(ev(c("is_false", "boolean"), "false")).toBe(true);
    expect(ev(c("is_false", "boolean"), true)).toBe(false);
  });
  it("sin un si/no claro no se cumple ninguno de los dos", () => {
    expect(ev(c("is_true", "boolean"), undefined)).toBe(false);
    expect(ev(c("is_false", "boolean"), undefined)).toBe(false);
    expect(ev(c("is_true", "boolean"), "tal vez")).toBe(false);
  });
});

describe("los operadores viejos y el tipo", () => {
  it("sin valueType, un operador viejo usa la semantica de siempre (texto exacto, gt numerico crudo)", () => {
    expect(ev({ field: "x", operator: "equals", value: "A" }, "a")).toBe(false);
    expect(ev({ field: "x", operator: "equals", value: "a" }, "a")).toBe(true);
    expect(ev({ field: "x", operator: "gt", value: "9" }, "12")).toBe(true);
    expect(ev({ field: "x", operator: "exists" }, "")).toBe(false);
    expect(ev({ field: "x", operator: "not_equals", value: "a" }, undefined)).toBe(true);
  });

  it("con valueType, `gt` es el numerico tipado (abc no cumple)", () => {
    expect(ev({ field: "x", operator: "gt", value: "1", valueType: "number" }, "abc")).toBe(false);
  });

  // Paridad con el operador REAL del registro (el que usa condition.ts): misma funcion.
  const TABLE: Array<[string, string | undefined, string]> = [
    ["equals", "a", "a"], ["equals", "a", "A"], ["equals", undefined, ""],
    ["not_equals", "a", "b"], ["not_equals", undefined, "a"], ["not_equals", "a", "a"],
    ["contains", "hola mundo", "mundo"], ["contains", "hola", ""], ["contains", undefined, "a"], ["contains", "Hola", "hola"],
    ["exists", "x", ""], ["exists", "", ""], ["exists", undefined, ""],
    ["gt", "12", "9"], ["gt", "abc", "1"], ["gt", "", "-1"], ["gt", "5", "5"],
    ["lt", "9", "12"], ["lt", "", "1"], ["lt", "abc", "1"], ["lt", undefined, "1"],
  ];
  it.each(TABLE)("%s(%j, %j) da lo mismo que el registro", async (operator, actual, expected) => {
    await import("./registry");
    const registered = getConditionOperator(operator)!;
    expect(evaluateCondition({ field: "x", operator, value: expected }, actual)).toBe(registered.evaluate(actual, expected));
  });

  it("los seis viejos comparten la funcion con el registro", async () => {
    await import("./registry");
    for (const legacy of LEGACY_OPERATORS) {
      expect(getConditionOperator(legacy.operator)?.evaluate).toBe(legacy.evaluate);
    }
  });
});

describe("operador desconocido o valor raro: nunca lanza, no se cumple", () => {
  it("operador inventado", () => {
    expect(ev({ field: "x", operator: "inventado", value: "1" }, "1")).toBe(false);
    expect(ev(c("inventado", "text"), "1")).toBe(false);
  });
  it("un operador de otro tipo no se cumple", () => {
    expect(ev(c("gt", "text", { value: "1" }), "5")).toBe(false);
    expect(ev(c("includes", "number", { value: "1" }), 5)).toBe(false);
  });
  it("un objeto raro como valor no lanza", () => {
    expect(ev(c("is", "text", { value: "a" }), { a: 1 } as unknown as FieldValue)).toBe(false);
  });
});

describe("inferencia del tipo por el operador", () => {
  it("cada operador propio de un tipo lo deduce", () => {
    expect(inferValueType("gte")).toBe("number");
    expect(inferValueType("includes_all")).toBe("multi_select");
    expect(inferValueType("within_last_days")).toBe("date");
    expect(inferValueType("is_true")).toBe("boolean");
    expect(inferValueType("is_any_of")).toBe("single_select");
    expect(inferValueType("not_contains")).toBe("text");
    expect(inferValueType("equals")).toBeNull();
  });
  it("una condicion sin valueType evalua con el tipo deducido", () => {
    expect(ev({ field: "x", operator: "includes_any", values: ["b"] }, ["A", "B"])).toBe(true);
    expect(ev({ field: "x", operator: "between", value: "1", value2: "3" }, 2)).toBe(true);
  });
  it("todos los operadores tienen etiqueta y cantidad de valores", () => {
    for (const list of Object.values(OPERATORS_BY_TYPE)) {
      for (const op of list) {
        expect(op.label.length).toBeGreaterThan(0);
        expect(["none", "one", "two", "list", "days"]).toContain(op.arity);
      }
    }
    expect(operatorInfo("equals")?.label).toBe("es igual a");
    expect(operatorInfo("nada")).toBeUndefined();
  });
});

describe("grupos", () => {
  const resolveFrom = (values: Record<string, FieldValue>) => (field: string) => {
    if (!(field in values)) throw new MissingFieldError(field);
    return values[field];
  };
  const isA = (field: string): BranchCondition => c("is", "single_select", { field, value: "a" });

  it("and: todas; or: alguna", () => {
    const resolve = resolveFrom({ p: "a", q: "b" });
    expect(evaluateGroup({ logic: "and", conditions: [isA("p"), isA("q")] }, resolve)).toBe(false);
    expect(evaluateGroup({ logic: "or", conditions: [isA("p"), isA("q")] }, resolve)).toBe(true);
    expect(evaluateGroup({ logic: "and", conditions: [isA("p")] }, resolve)).toBe(true);
  });
  it("grupo vacio: `and` se cumple, `or` no (igual que el nodo viejo)", () => {
    expect(evaluateGroup({ logic: "and", conditions: [] }, resolveFrom({}))).toBe(true);
    expect(evaluateGroup({ logic: "or", conditions: [] }, resolveFrom({}))).toBe(false);
  });
  it("un campo que ya no existe no se cumple (ni siquiera is_empty) y queda marcado", () => {
    const group = { logic: "and" as const, conditions: [c("is_empty", "text", { field: "borrada" })] };
    const result = evaluateGroupDetailed(group, resolveFrom({}));
    expect(result.passed).toBe(false);
    expect(result.checks).toEqual([{ field: "borrada", operator: "is_empty", ok: false, missing: true }]);
  });
  it("un resolver que falla (otro error) no se cumple y sigue, sin lanzar", () => {
    const boom = () => {
      throw new Error("se cayo la base");
    };
    const group = { logic: "or" as const, conditions: [isA("p"), c("is_empty", "text", { field: "q" })] };
    const result = evaluateGroupDetailed(group, (field) => (field === "p" ? boom() : "x"));
    expect(result.checks).toEqual([
      { field: "p", operator: "is", ok: false, error: true },
      { field: "q", operator: "is_empty", ok: false },
    ]);
    expect(result.passed).toBe(false);
  });
  it("los checks nunca llevan el valor", () => {
    const result = evaluateGroupDetailed({ logic: "and", conditions: [isA("p")] }, () => "juan@correo.com");
    expect(JSON.stringify(result.checks)).not.toContain("juan");
  });
  it("una condicion rota (sin campo) no tumba el grupo", () => {
    const result = evaluateGroupDetailed({ logic: "and", conditions: [null as unknown as BranchCondition] }, () => "x");
    expect(result.passed).toBe(false);
  });
});

describe("pickPath: el primero que se cumple, en orden", () => {
  const path = (id: string, field: string, value: string): BranchPath => ({ id, label: id, logic: "and", conditions: [c("is", "single_select", { field, value })] });
  const paths = [path("p_a", "r", "A"), path("p_b", "r", "B"), path("p_c", "r", "B")];

  it("con una respuesta que cumple B y C, gana B (el primero)", () => {
    const pick = pickPath(paths, () => "B");
    expect(pick.path?.id).toBe("p_b");
    expect(pick.index).toBe(1);
    // Despues de B ni se mira C.
    expect(pick.evaluated.map((e) => e.pathId)).toEqual(["p_a", "p_b"]);
  });
  it("si ninguno se cumple: path null (el `Si no`)", () => {
    const pick = pickPath(paths, () => "Z");
    expect(pick.path).toBeNull();
    expect(pick.index).toBe(-1);
    expect(pick.evaluated).toHaveLength(3);
  });
  it("sin caminos: `Si no`", () => {
    expect(pickPath([], () => "A").path).toBeNull();
    expect(pickPath(undefined as unknown as BranchPath[], () => "A").path).toBeNull();
  });
  it("si el resolver falla en el primer camino, sigue con el segundo", () => {
    const pick = pickPath(paths, (field) => {
      if (field === "r") throw new MissingFieldError("r");
      return "A";
    });
    expect(pick.path).toBeNull();
    expect(pick.evaluated[0].checks[0]).toMatchObject({ ok: false, missing: true });

    const mixed = [path("p_x", "gone", "A"), path("p_y", "r", "B")];
    const pick2 = pickPath(mixed, (field) => {
      if (field === "gone") throw new MissingFieldError("gone");
      return "B";
    });
    expect(pick2.path?.id).toBe("p_y");
  });
  it("un camino sin condiciones con `and` se cumple siempre (como el grupo vacio)", () => {
    const pick = pickPath([{ id: "p_vacio", label: "Todos", logic: "and", conditions: [] }], () => "A");
    expect(pick.path?.id).toBe("p_vacio");
  });
});

describe("explicar con palabras", () => {
  const fieldLabel = "Facturación";
  const optionLabels = { mas_10k: "Más de USD 10.000", menos: "Menos de USD 1.000" };

  it("el criterio de ejemplo: «Facturación es Más de USD 10.000»", () => {
    expect(describeCondition(c("is", "single_select", { value: "mas_10k" }), { fieldLabel, optionLabels })).toBe("Facturación es «Más de USD 10.000»");
  });
  it("sin etiqueta de opcion muestra el valor; sin etiqueta de campo, la ruta", () => {
    expect(describeCondition(c("is", "single_select", { field: "answer.x", value: "zzz" }))).toBe("answer.x es «zzz»");
  });
  it("numero, rango, fecha y dias", () => {
    expect(describeCondition(c("gt", "number", { value: "30" }), { fieldLabel: "Edad" })).toBe("Edad es mayor que 30");
    expect(describeCondition(c("between", "number", { value: "18", value2: "30" }), { fieldLabel: "Edad" })).toBe("Edad está entre 18 y 30");
    expect(describeCondition(c("before", "date", { value: "2026-10-12" }), { fieldLabel: "Fecha" })).toBe("Fecha es antes de 2026-10-12");
    expect(describeCondition(c("within_last_days", "date", { value: "7" }), { fieldLabel: "Alta" })).toBe("Alta fue en los últimos 7 días");
  });
  it("listas: alguna de (o) y todas (y)", () => {
    expect(describeCondition(c("includes_any", "multi_select", { values: ["a", "b", "c"] }), { fieldLabel: "Tags" })).toBe("Tags incluye alguna de «a», «b» o «c»");
    expect(describeCondition(c("includes_all", "multi_select", { values: ["a", "b"] }), { fieldLabel: "Tags" })).toBe("Tags incluye todas «a» y «b»");
  });
  it("sin valor y operador viejo", () => {
    expect(describeCondition(c("is_empty", "text"), { fieldLabel: "Notas" })).toBe("Notas está vacío");
    expect(describeCondition({ field: "tag:vip", operator: "equals", value: "true" })).toBe("tag:vip es igual a «true»");
    expect(describeCondition({ field: "x", operator: "zzz" })).toBe("x zzz");
  });
  it("un grupo", () => {
    const group = { logic: "or" as const, conditions: [c("gt", "number", { field: "a", value: "1" }), c("is_true", "boolean", { field: "b" })] };
    expect(describeGroup(group)).toBe("a es mayor que 1 o b es sí");
    expect(describeGroup({ logic: "and", conditions: [] })).toBe("Siempre");
  });
});

/**
 * PARIDAD con las reglas de mostrar/ocultar campos de Formularios
 * (`lib/forms/visibility.ts`): en los operadores que comparten significado,
 * el mismo valor da el mismo resultado. Las diferencias estan documentadas en
 * el bloque siguiente y son a proposito.
 */
describe("paridad con lib/forms/visibility.ts", () => {
  type Row = { op: VisibilityCondition["operator"]; answer: FieldValue; value: string; type: ConditionValueType };
  const ROWS: Row[] = [
    // is / is_not
    { op: "is", answer: "Hola", value: "hola", type: "text" },
    { op: "is", answer: "x", value: "y", type: "text" },
    { op: "is", answer: "", value: "y", type: "text" },
    { op: "is", answer: "crm", value: "CRM", type: "single_select" },
    { op: "is", answer: undefined, value: "crm", type: "single_select" },
    { op: "is_not", answer: "crm", value: "erp", type: "single_select" },
    { op: "is_not", answer: "crm", value: "crm", type: "single_select" },
    { op: "is_not", answer: "", value: "crm", type: "single_select" },
    { op: "is_not", answer: "a", value: "b", type: "text" },
    // contains / not_contains sobre texto
    { op: "contains", answer: "hola mundo", value: "MUNDO", type: "text" },
    { op: "contains", answer: "hola", value: "mundo", type: "text" },
    { op: "contains", answer: "", value: "a", type: "text" },
    { op: "not_contains", answer: "hola", value: "mundo", type: "text" },
    { op: "not_contains", answer: "hola mundo", value: "mundo", type: "text" },
    { op: "not_contains", answer: "", value: "a", type: "text" },
    // vacio
    { op: "is_empty", answer: "  ", value: "", type: "text" },
    { op: "is_empty", answer: "a", value: "", type: "text" },
    { op: "is_not_empty", answer: "a", value: "", type: "text" },
    { op: "is_not_empty", answer: undefined, value: "", type: "text" },
    // numericos
    { op: "gt", answer: "12", value: "9", type: "number" },
    { op: "gt", answer: "9", value: "12", type: "number" },
    { op: "lt", answer: "3", value: "10", type: "number" },
    { op: "gte", answer: "10", value: "10", type: "number" },
    { op: "lte", answer: "10", value: "10", type: "number" },
    { op: "gt", answer: "abc", value: "1", type: "number" },
    { op: "lt", answer: "", value: "1", type: "number" },
    { op: "gte", answer: "5", value: "", type: "number" },
  ];
  const OP_MAP: Record<string, string> = { gt: "gt", lt: "lt", gte: "gte", lte: "lte" };

  it.each(ROWS.map((r) => [`${r.op}(${JSON.stringify(r.answer)}, ${JSON.stringify(r.value)}) como ${r.type}`, r] as const))("%s", (_name, row) => {
    const visibility = evaluateVisibilityCondition({ fieldKey: "k", operator: row.op, value: row.value }, { k: row.answer as never });
    const ours = evaluateCondition({ field: "k", operator: OP_MAP[row.op] ?? row.op, value: row.value, valueType: row.type }, row.answer);
    expect(ours).toBe(visibility);
  });

  it("includes_any: la lista de la regla viaja separada por comas en Formularios y como `values` aca", () => {
    const answer = ["A", "B"];
    const visibility = evaluateVisibilityCondition({ fieldKey: "k", operator: "includes_any", value: "B, C" }, { k: answer });
    const ours = evaluateCondition({ field: "k", operator: "includes_any", values: ["B", "C"], valueType: "multi_select" }, answer);
    expect(ours).toBe(visibility);
    expect(ours).toBe(true);
    // Sin coincidencia, igual.
    expect(evaluateCondition({ field: "k", operator: "includes_any", values: ["C"], valueType: "multi_select" }, answer)).toBe(
      evaluateVisibilityCondition({ fieldKey: "k", operator: "includes_any", value: "C" }, { k: answer }),
    );
  });

  describe("diferencias a proposito (documentadas)", () => {
    it("1. `contains` sobre una lista: Formularios pide un elemento igual; aca, texto, busca dentro del texto unido. Para listas se usa `includes` (elemento exacto)", () => {
      const answer = ["Marketing", "Ventas"];
      expect(evaluateVisibilityCondition({ fieldKey: "k", operator: "contains", value: "market" }, { k: answer })).toBe(false);
      expect(evaluateCondition({ field: "k", operator: "contains", value: "market", valueType: "text" }, answer)).toBe(true);
      expect(evaluateCondition({ field: "k", operator: "includes", value: "market", valueType: "multi_select" }, answer)).toBe(false);
      expect(evaluateCondition({ field: "k", operator: "includes", value: "marketing", valueType: "multi_select" }, answer)).toBe(true);
    });
    it("2. fechas: Formularios las compara con gt/lt entre textos ISO; aca hay operadores propios de fecha (before/after) y `gt` solo es numerico", () => {
      expect(evaluateVisibilityCondition({ fieldKey: "k", operator: "gt", value: "2026-10-01" }, { k: "2026-10-12" })).toBe(true);
      expect(evaluateCondition({ field: "k", operator: "gt", value: "2026-10-01", valueType: "number" }, "2026-10-12")).toBe(false);
      expect(evaluateCondition({ field: "k", operator: "after", value: "2026-10-01", valueType: "date" }, "2026-10-12")).toBe(true);
    });
    it("3. un campo que no se pudo leer: Formularios lo ve vacio; aca no se cumple NI is_empty (la pregunta ya no existe, no esta vacia)", () => {
      const result = evaluateGroupDetailed({ logic: "and", conditions: [{ field: "k", operator: "is_empty", valueType: "text" }] }, () => {
        throw new MissingFieldError("k");
      });
      expect(result.passed).toBe(false);
      expect(evaluateVisibilityCondition({ fieldKey: "k", operator: "is_empty", value: "" }, {})).toBe(true);
    });
    it("4. `is_not` / `not_contains` con un valor presente igual; los dos tratan vacio como \"no es\" (paridad), a diferencia de los numericos, donde vacio no cumple nada", () => {
      expect(evaluateCondition({ field: "k", operator: "neq", value: "5", valueType: "number" }, "")).toBe(false);
      expect(evaluateCondition({ field: "k", operator: "is_not", value: "5", valueType: "text" }, "")).toBe(true);
    });
  });
});
