import { describe, expect, it } from "vitest";
import cases from "./relative-triggers.cases.json";
import { periodicConfigProblems, relativeConfigProblems, relativeDue, relativeTriggerLabel, type RelativeDueInput } from "./relative-triggers";

describe("relativeDue (casos compartidos con svc_relative_due)", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      expect(relativeDue(c.input as RelativeDueInput)).toEqual(c.expected);
    });
  }
});

describe("configuración y frase", () => {
  it("pide lo que falta", () => {
    expect(relativeConfigProblems({ anchor: "phase_start", offset_days: 3 })).toEqual(["Elegí la fase."]);
    expect(relativeConfigProblems({ anchor: "service_start", offset_days: 500 })).toEqual(["Los días van de −365 a 365."]);
    expect(periodicConfigProblems({ phase_key: "ph_a", every_days: 0 })).toEqual(["Cada cuántos días: de 1 a 90."]);
    expect(periodicConfigProblems({ phase_key: "ph_a", every_days: 7 })).toEqual([]);
  });
  it("arma la frase", () => {
    expect(relativeTriggerLabel({ anchor: "service_start", offset_days: 7 })).toBe("7 día(s) después del inicio del servicio");
    expect(relativeTriggerLabel({ anchor: "service_end", offset_days: -3 })).toBe("3 día(s) antes del fin del servicio");
  });
});
