// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { moduleTargetOptions, overrideFormOf, overrideRuleFromForm, targetsForModule } from "./module-override";
import { unlockRuleProblems } from "./unlock";
import type { ProgramRow } from "./tree";

const row = (id: string, kind: ProgramRow["kind"], parent: string | null, position = 0): ProgramRow => ({ id, parent_id: parent, kind, lesson_type: kind === "lesson" ? "video" : null, title: id, position, status: "active" });

describe("las opciones de «al completar algo» para un módulo", () => {
  const rows = [row("m1", "module", null, 1), row("s1", "submodule", "m1"), row("l1", "lesson", "s1"), row("m2", "module", null, 2), row("l2", "lesson", "m2")];
  const variants = [{ id: "v", name: "Lite", phases: [{ key: "p", name: "Fase", steps: [{ key: "it_plan90", name: "Plan de 90 días" }] }] }] as never;
  const opts = moduleTargetOptions(rows, variants);
  it("cada clase sabe de qué módulo es", () => expect(opts.program.map((o) => [o.id, o.moduleId])).toEqual([["m1", "m1"], ["s1", "m1"], ["l1", "m1"], ["m2", "m2"], ["l2", "m2"]]));
  it("no ofrece el propio módulo ni lo que cuelga de él", () => expect(targetsForModule(opts, "m1").program.map((o) => o.id)).toEqual(["m2", "l2"]));
  it("los pasos del camino van siempre", () => expect(targetsForModule(opts, "m1").journey.map((o) => o.id)).toEqual(["it_plan90"]));
});

describe("el formulario de «Programar…»", () => {
  const base = { type: "fixed_date", date: "", days: "", target: "", display: "", text: "" };
  it("una fecha, sin texto, es Próximamente por defecto", () => expect(overrideRuleFromForm({ ...base, date: "2026-12-01" })).toEqual({ type: "fixed_date", date: "2026-12-01" }));
  it("el texto va al lugar que corresponde", () => {
    expect(overrideRuleFromForm({ ...base, date: "2026-12-01", text: "Pronto" })).toMatchObject({ coming_soon_text: "Pronto" });
    expect(overrideRuleFromForm({ ...base, type: "after_complete", target: "journey_item:it_plan90", text: "Entregá tu plan" })).toEqual({ type: "after_complete", target: "journey_item", id: "it_plan90", locked_text: "Entregá tu plan" });
  });
  it("sin elegir qué completar, la regla no se puede guardar", () => expect(unlockRuleProblems(overrideRuleFromForm({ ...base, type: "after_complete" }))).toContain("elegí qué hay que completar"));
  it("un tipo que no se ofrece no pasa", () => expect(overrideRuleFromForm({ ...base, type: "automation" }).type).toBe(""));
  it("ida y vuelta", () => {
    const rule = { type: "days_after_start", days: 7, display: "locked" as const, locked_text: "Esperá una semana" };
    expect(overrideRuleFromForm(overrideFormOf(rule))).toEqual(rule);
  });
});
