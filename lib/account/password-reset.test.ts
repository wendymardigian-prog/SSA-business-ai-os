import { describe, expect, it } from "vitest";
import { parseConfirmType, safeNextPath } from "./password-reset";

describe("safeNextPath", () => {
  it("solo rutas propias", () => {
    expect(safeNextPath("/restablecer")).toBe("/restablecer");
    expect(safeNextPath("//evil.com")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.com")).toBe("/dashboard");
    expect(safeNextPath("https://evil.com")).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
  });
});

describe("parseConfirmType", () => {
  it("solo los tipos de Supabase Auth", () => {
    expect(parseConfirmType("recovery")).toBe("recovery");
    expect(parseConfirmType("otra")).toBeNull();
    expect(parseConfirmType(null)).toBeNull();
  });
});
