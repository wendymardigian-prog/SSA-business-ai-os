import { describe, it, expect } from "vitest";
import { qualifiesForGraduation, approvedUnchangedPct, graduationRule } from "./graduation";

const stats = (over = {}) => ({ categoryId: "cat-1", categoryName: "Pregunta cuándo empieza", finalDrafts: 42, approvedUnchanged: 40, ...over });

describe("graduación de categorías (F26)", () => {
  it("califica con ≥20 borradores y ≥85% aprobados", () => {
    expect(qualifiesForGraduation(stats())).toBe(true); // 40/42 = 95%
  });
  it("no califica con pocos borradores", () => {
    expect(qualifiesForGraduation(stats({ finalDrafts: 10, approvedUnchanged: 10 }))).toBe(false);
  });
  it("no califica bajo el 85%", () => {
    expect(qualifiesForGraduation(stats({ finalDrafts: 30, approvedUnchanged: 20 }))).toBe(false); // 66%
  });
  it("porcentaje exacto", () => {
    expect(approvedUnchangedPct(stats({ finalDrafts: 42, approvedUnchanged: 40 }))).toBeCloseTo(95.2, 1);
  });
  it("la regla generada envía directo por intención", () => {
    const r = graduationRule(stats(), () => "r_x");
    expect(r).toMatchObject({ id: "r_x", action: "send" });
    expect(r.conditions[0]).toMatchObject({ field: "intent.category", op: "is" });
    expect(r.conditions[0].value).toMatchObject({ category_id: "cat-1" });
  });
});
