import { describe, it, expect } from "vitest";
import { defaultOperatorFor, isOperatorValidFor, needsValue, operatorsFor, valueInputFor } from "./visibility-ui";
import { FORM_FIELD_TYPES } from "./fields";
import { CONDITION_OPERATORS } from "./visibility-types";

describe("operatorsFor", () => {
  it("todos los tipos ofrecen al menos un operador, todos conocidos", () => {
    for (const type of FORM_FIELD_TYPES) {
      const ops = operatorsFor(type);
      expect(ops.length, type).toBeGreaterThan(0);
      for (const op of ops) expect(CONDITION_OPERATORS).toContain(op.value);
    }
  });

  it("los números se pueden comparar y el texto se puede buscar", () => {
    expect(operatorsFor("number").map((o) => o.value)).toContain("gt");
    expect(operatorsFor("short_text").map((o) => o.value)).toContain("contains");
    expect(operatorsFor("short_text").map((o) => o.value)).not.toContain("gt");
    expect(operatorsFor("multi_select").map((o) => o.value)).toContain("includes_any");
  });
});

describe("valueInputFor", () => {
  it("elige cómo se pide el valor", () => {
    expect(valueInputFor("single_select", "is")).toBe("options");
    expect(valueInputFor("single_select", "includes_any")).toBe("text");
    expect(valueInputFor("consent", "is")).toBe("boolean");
    expect(valueInputFor("nps", "lte")).toBe("number");
    expect(valueInputFor("date", "gt")).toBe("date");
    expect(valueInputFor("short_text", "is_empty")).toBe("none");
    expect(needsValue("is_not_empty")).toBe(false);
  });
});

describe("operadores por defecto", () => {
  it("el primero de cada tipo es válido para ese tipo", () => {
    for (const type of FORM_FIELD_TYPES) expect(isOperatorValidFor(type, defaultOperatorFor(type))).toBe(true);
    expect(isOperatorValidFor("short_text", "gt")).toBe(false);
  });
});
