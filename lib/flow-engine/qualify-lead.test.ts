import { describe, expect, it } from "vitest";
import { crmEventMatches } from "./registry/triggers";
import {
  checkQualifyStep,
  describeQualificationTrigger,
  parseQualificationTrigger,
  qualificationEventMatches,
  describeQualifyStep,
  qualifyOutcome,
  rulesReason,
  type QualificationRule,
  type QualifyLeadStepData,
} from "./qualify-lead";

const rule = (id: string, points: number, label?: string): QualificationRule => ({
  id,
  label,
  points,
  logic: "and",
  conditions: [{ field: "answer.presupuesto", operator: "gt", value: "5000", valueType: "number" }],
});

const step = (data: Partial<QualifyLeadStepData>): Partial<QualifyLeadStepData> => ({ actionType: "qualify_lead", ...data });

describe("checkQualifyStep", () => {
  it("fijar pide un nivel de 1 a 5", () => {
    expect(checkQualifyStep(step({ mode: "set", level: 3 }))).toBeNull();
    expect(checkQualifyStep(step({ mode: "set", level: 0 }))).toBe("Elegí un nivel del 1 al 5.");
  });
  it("sumar pide puntos distintos de 0, entre -4 y +4", () => {
    expect(checkQualifyStep(step({ mode: "add", points: -2 }))).toBeNull();
    expect(checkQualifyStep(step({ mode: "add", points: 0 }))).not.toBeNull();
    expect(checkQualifyStep(step({ mode: "add", points: 5 }))).not.toBeNull();
  });
  it("las reglas piden al menos una, con condiciones y puntos, y desde dónde contar", () => {
    expect(checkQualifyStep(step({ mode: "rules", base: "current", rules: [rule("r_1", 1)] }))).toBeNull();
    expect(checkQualifyStep(step({ mode: "rules", base: "current", rules: [] }))).toBe("Sumá al menos una regla.");
    expect(checkQualifyStep(step({ mode: "rules", rules: [rule("r_1", 1)] }))).toBe("Elegí desde dónde se cuenta.");
    expect(checkQualifyStep(step({ mode: "rules", base: 1, rules: [{ ...rule("r_1", 1), conditions: [] }] }))).toBe(
      "Regla 1: sumá al menos una condición.",
    );
  });
  it("sin modo, o uno inventado, no vale", () => {
    expect(checkQualifyStep(null)).not.toBeNull();
    expect(checkQualifyStep(step({ mode: "multiplicar" as never }))).not.toBeNull();
  });
});

describe("qualifyOutcome", () => {
  it("fijar y quitar", () => {
    expect(qualifyOutcome(step({ mode: "set", level: 4 }), 2)).toMatchObject({ kind: "apply", mode: "set", target: 4 });
    expect(qualifyOutcome(step({ mode: "clear" }), 2)).toMatchObject({ kind: "apply", mode: "clear", target: null });
  });
  it("sumar recorta entre 1 y 5", () => {
    expect(qualifyOutcome(step({ mode: "add", points: 2 }), 4)).toMatchObject({ kind: "apply", mode: "add", value: 2, target: 5 });
    expect(qualifyOutcome(step({ mode: "add", points: 1 }), null)).toMatchObject({ target: 1 });
  });
  it("según reglas desde el nivel actual: suma TODAS las que se cumplen", () => {
    const data = step({ mode: "rules", base: "current", rules: [rule("a", 1), rule("b", 2), rule("c", -1)] });
    expect(qualifyOutcome(data, 2, [1, 2])).toMatchObject({ kind: "apply", mode: "add", value: 3, target: 5 });
    expect(qualifyOutcome(data, 2, [1, -1])).toEqual({ kind: "none", reason: "Las reglas que se cumplieron suman 0." });
    expect(qualifyOutcome(data, 2, [])).toEqual({ kind: "none", reason: "No se cumplió ninguna regla." });
  });
  it("según reglas desde un nivel fijo: fija base + puntos, recortado", () => {
    const data = step({ mode: "rules", base: 1, rules: [rule("a", 2), rule("b", 4)] });
    expect(qualifyOutcome(data, 5, [2])).toMatchObject({ kind: "apply", mode: "set", value: 3, target: 3, points: 2 });
    expect(qualifyOutcome(data, null, [2, 4])).toMatchObject({ mode: "set", target: 5 });
  });
  it("un paso mal armado no aplica nada", () => {
    expect(qualifyOutcome(step({ mode: "set" }), 1).kind).toBe("none");
  });
});

describe("en palabras", () => {
  it("describe cada modo", () => {
    expect(describeQualifyStep(step({ mode: "set", level: 5 }))).toBe("Calificar lead: nivel 5");
    expect(describeQualifyStep(step({ mode: "add", points: 2 }))).toBe("Calificar lead: +2 puntos");
    expect(describeQualifyStep(step({ mode: "clear" }))).toBe("Quitar la calificación");
    expect(describeQualifyStep(step({ mode: "rules", base: "current", rules: [rule("a", 1)] }))).toBe(
      "Calificar lead según 1 regla (desde el nivel actual)",
    );
  });
  it("el motivo nombra las reglas que se cumplieron, nunca los valores", () => {
    const rules = [rule("a", 1, "Presupuesto alto"), rule("b", 2)];
    expect(rulesReason(rules, new Set(["a", "b"]))).toBe("Presupuesto alto (+1), Regla 2 (+2)");
    expect(rulesReason(rules, new Set())).toBe("Ninguna regla se cumplió");
  });
});

describe("el disparador «Cambió la calificación»", () => {
  const ev = (level: number | null, previous: number | null) => ({ level, previous_level: previous });
  it("vacío: cualquier cambio", () => {
    expect(qualificationEventMatches("", ev(2, 1))).toBe(true);
  });
  it("sube / baja (quitarla es bajar)", () => {
    expect(qualificationEventMatches("up", ev(3, null))).toBe(true);
    expect(qualificationEventMatches("up", ev(2, 3))).toBe(false);
    expect(qualificationEventMatches("down", ev(null, 2))).toBe(true);
  });
  it("llega a N o más: solo al cruzar", () => {
    expect(qualificationEventMatches("gte:4", ev(4, 3))).toBe(true);
    expect(qualificationEventMatches("gte:4", ev(5, null))).toBe(true);
    expect(qualificationEventMatches("gte:4", ev(5, 4))).toBe(false);
    expect(qualificationEventMatches("gte:4", ev(3, 1))).toBe(false);
  });
  it("queda en N / baja de N", () => {
    expect(qualificationEventMatches("eq:2", ev(2, 5))).toBe(true);
    expect(qualificationEventMatches("eq:2", ev(3, 5))).toBe(false);
    expect(qualificationEventMatches("lt:3", ev(2, 3))).toBe(true);
    expect(qualificationEventMatches("lt:3", ev(1, 2))).toBe(false);
  });
  it("un valor inventado cuenta como «cualquiera»", () => {
    expect(parseQualificationTrigger("gte:9")).toEqual({ kind: "any", level: null });
    expect(describeQualificationTrigger("gte:4")).toBe("cuando llega a 4 o más");
  });
  it("el evento del CRM lo enruta por el mismo criterio", () => {
    expect(crmEventMatches({ event: "qualification_changed", value: "gte:4" }, { event_type: "qualification_changed", payload: ev(4, 2) })).toBe(true);
    expect(crmEventMatches({ event: "qualification_changed", value: "gte:4" }, { event_type: "qualification_changed", payload: ev(3, 2) })).toBe(false);
    expect(crmEventMatches({ event: "qualification_changed" }, { event_type: "qualification_changed", payload: ev(1, null) })).toBe(true);
  });
});
