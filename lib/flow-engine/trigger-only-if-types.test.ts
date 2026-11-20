import { describe, expect, it } from "vitest";
import { parseTriggerOnlyIfInput } from "./trigger-only-if-types";

describe("parseTriggerOnlyIfInput", () => {
  it("null o vacío lo saca", () => {
    expect(parseTriggerOnlyIfInput(null)).toEqual({ ok: true, group: null });
    expect(parseTriggerOnlyIfInput({ logic: "and", conditions: [] })).toEqual({ ok: true, group: null });
  });
  it("acepta un grupo bien armado", () => {
    const r = parseTriggerOnlyIfInput({ logic: "or", conditions: [{ field: "booking.status", operator: "is", value: "sale", valueType: "text" }] });
    expect(r).toEqual({ ok: true, group: { logic: "or", conditions: [{ field: "booking.status", operator: "is", value: "sale", valueType: "text" }] } });
  });
  it("rechaza una condición a medias o una forma rara", () => {
    expect(parseTriggerOnlyIfInput({ logic: "and", conditions: [{ field: "", operator: "is" }] }).ok).toBe(false);
    expect(parseTriggerOnlyIfInput({ logic: "xor", conditions: [] }).ok).toBe(false);
    expect(parseTriggerOnlyIfInput("hola").ok).toBe(false);
    expect(parseTriggerOnlyIfInput({ conditions: Array.from({ length: 21 }, () => ({ field: "a", operator: "is" })) }).ok).toBe(false);
  });
});
