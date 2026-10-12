import { describe, it, expect } from "vitest";
import { canDecrement, canIncrement, clamp, decrement, increment, parseTyped } from "./stepper";

describe("stepper", () => {
  it("DADO min 0 y el valor 0, − está deshabilitado y apretarlo no cambia nada", () => {
    expect(canDecrement(0, { min: 0 })).toBe(false);
    expect(decrement(0, { min: 0 })).toBe(0);
  });

  it("DADO max 24 y el valor 24, + está deshabilitado", () => {
    expect(canIncrement(24, { min: 0, max: 24 })).toBe(false);
    expect(increment(24, { min: 0, max: 24 })).toBe(24);
  });

  it("suma y resta de a step", () => {
    expect(increment(4, { min: 0, step: 2 })).toBe(6);
    expect(decrement(4, { min: 0, step: 2 })).toBe(2);
    expect(decrement(1, { min: 0, step: 2 })).toBe(0);
  });

  it("vacío: el primer + lleva al mínimo más el paso; − no hace nada", () => {
    expect(increment(null, { min: 0 })).toBe(1);
    expect(increment(undefined, { min: 1, max: 10 })).toBe(2);
    expect(decrement(null, { min: 0 })).toBeNull();
  });

  it("CUANDO se escribe 12, vale 12; CUANDO se escribe abc, no cambia", () => {
    expect(parseTyped("12", { min: 0 })).toEqual({ kind: "value", value: 12 });
    expect(parseTyped("abc", { min: 0 }).kind).toBe("invalid");
    expect(parseTyped("1.5", { min: 0 }).kind).toBe("invalid");
    expect(parseTyped("  ", { min: 0 })).toEqual({ kind: "empty" });
  });

  it("un número escrito fuera de rango se marca como error", () => {
    expect(parseTyped("30", { min: 0, max: 24 })).toEqual({ kind: "invalid", reason: "El máximo es 24" });
    expect(parseTyped("-1", { min: 0 })).toEqual({ kind: "invalid", reason: "El mínimo es 0" });
  });

  it("con step 5, solo múltiplos", () => {
    expect(parseTyped("10", { min: 0, step: 5 }).kind).toBe("value");
    expect(parseTyped("12", { min: 0, step: 5 }).kind).toBe("invalid");
  });

  it("clamp", () => {
    expect(clamp(30, { min: 0, max: 24 })).toBe(24);
    expect(clamp(-3, { min: 0 })).toBe(0);
  });
});
