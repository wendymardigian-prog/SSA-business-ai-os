import { describe, expect, it } from "vitest";
import { diffFields } from "./diff";

describe("diffFields", () => {
  it("un cambio da antes y despues", () => {
    expect(diffFields({ name: "A" }, { name: "B" })).toEqual({ name: { before: "A", after: "B" } });
  });
  it("sin cambios da {}", () => {
    expect(diffFields({ name: "A", x: null }, { name: "A", x: "" })).toEqual({});
  });
  it("un campo nuevo o borrado cuenta", () => {
    expect(diffFields({}, { email: "a@b.com" })).toEqual({ email: { before: null, after: "a@b.com" } });
    expect(diffFields({ email: "a@b.com" }, {})).toEqual({ email: { before: "a@b.com", after: null } });
  });
  it("tolera null y undefined", () => {
    expect(diffFields(null, undefined)).toEqual({});
  });
});
