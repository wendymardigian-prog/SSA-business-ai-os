import { describe, it, expect } from "vitest";
import { colorOf, initialsOf, summarizeNames } from "./people";

describe("avatares", () => {
  it("iniciales", () => {
    expect(initialsOf("Ana Paula Gómez")).toBe("AG");
    expect(initialsOf("ana")).toBe("AN");
    expect(initialsOf("  ")).toBe("?");
  });
  it("el color es estable por persona", () => {
    expect(colorOf("u-1")).toBe(colorOf("u-1"));
    expect(colorOf("u-1")).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("resumen de nombres", () => {
    expect(summarizeNames([])).toBe("");
    expect(summarizeNames(["Ana"])).toBe("Ana");
    expect(summarizeNames(["Ana", "Bruno"])).toBe("Ana y Bruno");
    expect(summarizeNames(["A", "B", "C"])).toBe("A, B y C");
    expect(summarizeNames(["A", "B", "C", "D", "E"])).toBe("A, B, C y 2 más");
  });
});
