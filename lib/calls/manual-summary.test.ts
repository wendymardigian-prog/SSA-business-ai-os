import { describe, expect, it } from "vitest";
import { isManuallyLoaded, manualSummaryOf, parseManualSummary, withManualKept, withManualSummary } from "./manual-summary";

describe("parseManualSummary", () => {
  it("acepta resumen, pasos y notas, limpiando vacíos", () => {
    expect(parseManualSummary({ summary: " Hablamos ", nextSteps: [" Mandar el contrato ", "", "  "], notes: "" })).toEqual({
      ok: true,
      value: { summary: "Hablamos", next_steps: ["Mandar el contrato"], notes: "" },
    });
  });
  it("pide algo y respeta los largos", () => {
    expect(parseManualSummary({ summary: "", nextSteps: [], notes: "" }).ok).toBe(false);
    expect(parseManualSummary({ summary: "x".repeat(2001), nextSteps: [], notes: "" }).ok).toBe(false);
    expect(parseManualSummary({ summary: "ok", nextSteps: [], notes: "x".repeat(2001) }).ok).toBe(false);
    expect(parseManualSummary({ summary: "ok", nextSteps: Array.from({ length: 11 }, (_, i) => `p${i}`), notes: "" }).ok).toBe(false);
    expect(parseManualSummary({ summary: "ok", nextSteps: ["x".repeat(201)], notes: "" }).ok).toBe(false);
  });
});

describe("guardar sin pisar", () => {
  const manual = { summary: "s", next_steps: ["a"], notes: "n", by: "u1", at: "2026-11-12T10:00:00Z" };
  it("lo manual va en su clave y conserva el resumen automático", () => {
    expect(withManualSummary({ resumen: "auto" }, manual)).toEqual({ resumen: "auto", manual });
    expect(manualSummaryOf(withManualSummary(null, manual))).toEqual(manual);
  });
  it("el resumen automático nuevo conserva lo manual", () => {
    expect(withManualKept({ resumen: "nuevo" }, { resumen: "viejo", manual })).toEqual({ resumen: "nuevo", manual });
    expect(withManualKept({ resumen: "nuevo" }, { resumen: "viejo" })).toEqual({ resumen: "nuevo" });
  });
  it("«Cargada a mano» mientras no haya análisis", () => {
    expect(isManuallyLoaded({ manual }, "no_profile")).toBe(true);
    expect(isManuallyLoaded({ manual }, "done")).toBe(false);
    expect(isManuallyLoaded({ resumen: "x" }, "error")).toBe(false);
  });
});
