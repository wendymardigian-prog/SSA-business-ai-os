// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import cases from "./assistant.cases.json";
import { assistantCreditsPlan, monthStartIn, pickAssistantLimit } from "./assistant";

describe("créditos del asistente: casos compartidos con la base", () => {
  it.each(cases.cases.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    expect(assistantCreditsPlan(c.input)).toEqual(c.expected);
  });
});

describe("límite y mes", () => {
  it("el orden: propio, variante, programa, y 10 si no hay nada", () => {
    expect(pickAssistantLimit(null, null, null)).toBe(10);
    expect(pickAssistantLimit(undefined, 4, 7)).toBe(4);
    expect(pickAssistantLimit(-1, null, 7)).toBe(7);
  });
  it("el mes nuevo es el del negocio", () => {
    expect(monthStartIn(new Date("2026-12-01T03:00:00Z"), "America/Costa_Rica")).toBe("2026-11-01");
    expect(monthStartIn(new Date("2026-12-01T07:00:00Z"), "America/Costa_Rica")).toBe("2026-12-01");
  });
});
