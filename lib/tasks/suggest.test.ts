import { describe, it, expect } from "vitest";
import { suggestedTitle } from "./suggest";

describe("suggestedTitle (F20)", () => {
  it("«Dar seguimiento a <contacto>»", () => {
    expect(suggestedTitle("Ana  Gómez")).toBe("Dar seguimiento a Ana Gómez");
  });
  it("sin nombre, un titulo generico", () => {
    expect(suggestedTitle(null)).toBe("Dar seguimiento al contacto");
    expect(suggestedTitle("   ")).toBe("Dar seguimiento al contacto");
    expect(suggestedTitle("Sin nombre")).toBe("Dar seguimiento al contacto");
  });
  it("nunca pasa de 200 caracteres", () => {
    expect(suggestedTitle("x".repeat(500)).length).toBe(200);
  });
});
