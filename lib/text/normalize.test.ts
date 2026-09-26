import { describe, it, expect } from "vitest";
import { normalizeForGrouping, NORMALIZE_GROUPING_CASES } from "./normalize";

describe("normalizeForGrouping (F4)", () => {
  for (const { input, expected } of NORMALIZE_GROUPING_CASES) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(normalizeForGrouping(input)).toBe(expected);
    });
  }

  it("los cuatro sí caen en el mismo grupo", () => {
    const outs = ["Sí!!", "siii", "SI", "sí"].map(normalizeForGrouping);
    expect(new Set(outs)).toEqual(new Set(["si"]));
  });

  it("tolera null y undefined", () => {
    expect(normalizeForGrouping(null)).toBe("");
    expect(normalizeForGrouping(undefined)).toBe("");
  });

  it("trunca a 300 caracteres", () => {
    expect(normalizeForGrouping("a".repeat(500))).toBe("a"); // colapsa a uno primero
    expect(normalizeForGrouping(Array.from({ length: 500 }, (_, i) => (i % 2 ? "a" : "b")).join("")).length)
      .toBe(300);
  });
});
