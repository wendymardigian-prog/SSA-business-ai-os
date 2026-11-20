// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import cases from "./unlock.cases.json";
import { unlockPlan, unlockRuleProblems, type UnlockInput } from "./unlock";

describe("el desbloqueo (casos compartidos con la base)", () => {
  for (const c of cases.cases) it(c.name, () => expect(unlockPlan(c.input as UnlockInput)).toEqual(c.expected));
  it("hay al menos 25 casos", () => expect(cases.cases.length).toBeGreaterThanOrEqual(25));
});

describe("las reglas que se guardan", () => {
  it("una regla abierta no lleva «cómo se ve»", () => expect(unlockRuleProblems({ type: "open", display: "locked" })).toContain("una clase abierta no tiene «cómo se ve bloqueada»"));
  it("el texto de Próximamente tiene hasta 80 caracteres", () =>
    expect(unlockRuleProblems({ type: "fixed_date", date: "2026-12-01", display: "coming_soon", coming_soon_text: "x".repeat(81) })).toContain("el texto de «Próximamente» tiene hasta 80 caracteres"));
  it("el texto del candado tiene hasta 80 caracteres", () =>
    expect(unlockRuleProblems({ type: "after_complete", target: "journey_item", id: "it_plan90", locked_text: "x".repeat(81) })).toContain("el texto del candado tiene hasta 80 caracteres"));
  it("«al completar algo» apunta a un paso del camino o a una clase", () => {
    expect(unlockRuleProblems({ type: "after_complete", target: "journey_item", id: "it_plan90", locked_text: "Entregá tu Plan" })).toEqual([]);
    expect(unlockRuleProblems({ type: "after_complete", target: "otra_cosa", id: "x" })).toContain("lo que hay que completar no es válido");
    expect(unlockRuleProblems({ type: "after_complete", target: "journey_item" })).toContain("elegí qué hay que completar");
  });
  it("una regla bien armada no tiene problemas", () => {
    expect(unlockRuleProblems({ type: "days_after_start", days: 7 })).toEqual([]);
    expect(unlockRuleProblems({ type: "after_complete", target: "program_item", id: "x" })).toEqual([]);
  });
});
