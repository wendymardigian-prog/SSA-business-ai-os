// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import cases from "./set-dates.cases.json";
import { datesEditPlan, durationFromDates, endFromDuration, type DatesPlanInput } from "./set-dates";

describe("datesEditPlan: los casos compartidos con app_servicio.svc_dates_plan", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      expect(datesEditPlan(c.input as DatesPlanInput)).toEqual(c.expected);
    });
  }
  it("tiene al menos 12 casos", () => expect(cases.cases.length).toBeGreaterThanOrEqual(12));
});

describe("plazo y fin del formulario", () => {
  it("el fin sale del inicio y el plazo (los dos días incluidos)", () => {
    expect(endFromDuration("2026-11-03", 84)).toBe("2027-01-25");
    expect(endFromDuration("2026-11-03", 1)).toBe("2026-11-03");
    expect(endFromDuration("2026-11-03", 0)).toBeNull();
    expect(endFromDuration("x", 10)).toBeNull();
  });
  it("el plazo sale del inicio y el fin", () => {
    expect(durationFromDates("2026-11-03", "2027-01-25")).toBe(84);
    expect(durationFromDates("2026-11-03", "2026-11-02")).toBeNull();
    expect(durationFromDates(null, "2026-11-02")).toBeNull();
  });
});
