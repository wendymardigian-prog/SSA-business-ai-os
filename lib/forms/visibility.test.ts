import { describe, it, expect } from "vitest";
import {
  evaluateVisibility,
  isFieldVisible,
  pickVisibleAnswers,
  referencedKeys,
  visibleFieldKeys,
} from "./visibility";
import type { VisibilityConfig } from "./visibility-types";

const cond = (fieldKey: string, operator: VisibilityConfig["conditions"][number]["operator"], value = "") => ({
  fieldKey,
  operator,
  value,
});

describe("isFieldVisible", () => {
  it("sin reglas, siempre visible", () => {
    expect(isFieldVisible({}, {})).toBe(true);
    expect(isFieldVisible({ visibility: { rootConjunction: "and", conditions: [], groups: [] } }, {})).toBe(true);
  });

  it("mostrar `presupuesto` si `facturacion` es `más de 10k`", () => {
    const visibility: VisibilityConfig = {
      rootConjunction: "and",
      conditions: [cond("facturacion", "is", "más de 10k")],
      groups: [],
    };
    expect(isFieldVisible({ visibility }, { facturacion: "menos de 1k" })).toBe(false);
    expect(isFieldVisible({ visibility }, { facturacion: "más de 10k" })).toBe(true);
    expect(isFieldVisible({ visibility }, { facturacion: "MÁS DE 10K " })).toBe(true);
    expect(isFieldVisible({ visibility }, {})).toBe(false);
  });

  it("grupo (A or B) and C se evalúa con ese agrupamiento", () => {
    const visibility: VisibilityConfig = {
      rootConjunction: "and",
      conditions: [cond("c", "is", "si")],
      groups: [{ conjunction: "or", conditions: [cond("a", "is", "x"), cond("b", "is", "y")] }],
    };
    expect(evaluateVisibility(visibility, { c: "si", a: "x" })).toBe(true);
    expect(evaluateVisibility(visibility, { c: "si", b: "y" })).toBe(true);
    expect(evaluateVisibility(visibility, { c: "si", a: "z", b: "z" })).toBe(false);
    expect(evaluateVisibility(visibility, { c: "no", a: "x" })).toBe(false);
  });

  it("gt compara numéricamente aunque llegue como texto", () => {
    const visibility: VisibilityConfig = { rootConjunction: "and", conditions: [cond("n", "gt", "9")], groups: [] };
    expect(evaluateVisibility(visibility, { n: "12" })).toBe(true); // como texto "12" < "9"
    expect(evaluateVisibility(visibility, { n: "3" })).toBe(false);
    expect(evaluateVisibility(visibility, { n: "abc" })).toBe(false);
    expect(evaluateVisibility(visibility, { n: "" })).toBe(false);
  });

  it("compara fechas ISO", () => {
    const visibility: VisibilityConfig = { rootConjunction: "and", conditions: [cond("d", "gte", "2026-10-10")], groups: [] };
    expect(evaluateVisibility(visibility, { d: "2026-10-10" })).toBe(true);
    expect(evaluateVisibility(visibility, { d: "2026-09-30" })).toBe(false);
  });

  it("multi selección: contains, not_contains e includes_any", () => {
    const answers = { m: ["Uno", "Dos"] };
    expect(evaluateVisibility({ rootConjunction: "and", conditions: [cond("m", "contains", "uno")], groups: [] }, answers)).toBe(true);
    expect(evaluateVisibility({ rootConjunction: "and", conditions: [cond("m", "not_contains", "tres")], groups: [] }, answers)).toBe(true);
    expect(evaluateVisibility({ rootConjunction: "and", conditions: [cond("m", "includes_any", "tres, dos")], groups: [] }, answers)).toBe(true);
    expect(evaluateVisibility({ rootConjunction: "and", conditions: [cond("m", "includes_any", "tres,cuatro")], groups: [] }, answers)).toBe(false);
  });

  it("is_empty / is_not_empty / is_not con respuestas vacías", () => {
    const v = (op: "is_empty" | "is_not_empty" | "is_not") =>
      ({ rootConjunction: "and", conditions: [cond("x", op, "a")], groups: [] }) as VisibilityConfig;
    expect(evaluateVisibility(v("is_empty"), {})).toBe(true);
    expect(evaluateVisibility(v("is_empty"), { x: [] })).toBe(true);
    expect(evaluateVisibility(v("is_not_empty"), { x: "hola" })).toBe(true);
    expect(evaluateVisibility(v("is_not"), {})).toBe(true);
  });

  it("boolean del consentimiento", () => {
    const v: VisibilityConfig = { rootConjunction: "and", conditions: [cond("ok", "is", "true")], groups: [] };
    expect(evaluateVisibility(v, { ok: true })).toBe(true);
    expect(evaluateVisibility(v, { ok: false })).toBe(false);
  });
});

describe("visibleFieldKeys (encadenado)", () => {
  const fields = [
    { key: "a" },
    { key: "b", visibility: { rootConjunction: "and", conditions: [cond("a", "is", "si")], groups: [] } as VisibilityConfig },
    { key: "c", visibility: { rootConjunction: "and", conditions: [cond("b", "is_not_empty")], groups: [] } as VisibilityConfig },
  ];

  it("un campo cuya condición mira un campo oculto ve ese valor como vacío", () => {
    // `b` está oculto (a != si) pero viene con valor: `c` también debe quedar oculto.
    expect(visibleFieldKeys(fields, { a: "no", b: "colado", c: "x" })).toEqual(["a"]);
  });

  it("si `b` se muestra, `c` depende de su valor", () => {
    expect(visibleFieldKeys(fields, { a: "si", b: "algo" })).toEqual(["a", "b", "c"]);
    expect(visibleFieldKeys(fields, { a: "si", b: "" })).toEqual(["a", "b"]);
  });

  it("pickVisibleAnswers descarta lo que no se muestra", () => {
    expect(pickVisibleAnswers(fields, { a: "no", b: "colado", c: "x" })).toEqual({ a: "no" });
  });
});

describe("referencedKeys", () => {
  it("junta las claves de condiciones y grupos sin repetir", () => {
    const v: VisibilityConfig = {
      rootConjunction: "and",
      conditions: [cond("a", "is", "1")],
      groups: [{ conjunction: "or", conditions: [cond("a", "is", "2"), cond("b", "is", "3")] }],
    };
    expect(referencedKeys(v).sort()).toEqual(["a", "b"]);
    expect(referencedKeys(null)).toEqual([]);
  });
});
