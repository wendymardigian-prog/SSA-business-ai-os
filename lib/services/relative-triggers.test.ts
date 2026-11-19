import { describe, expect, it } from "vitest";
import cases from "./relative-triggers.cases.json";
import hoursCases from "./relative-hours.cases.json";
import { periodicConfigProblems, relativeConfigProblems, relativeDue, relativeHoursDue, relativeTriggerLabel, type RelativeDueInput } from "./relative-triggers";

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

describe("en horas (00460, casos compartidos con svc_relative_hours_due)", () => {
  for (const c of hoursCases.cases) {
    it(c.name, () => {
      expect(relativeHoursDue(Date.parse(c.anchor_at), c.offset_hours, Date.parse(c.now))).toBe(c.due);
    });
  }

  it("valida las horas y «antes» solo con inicio o fin", () => {
    expect(relativeConfigProblems({ anchor: "service_start", unit: "hours", offset_hours: -3 })).toEqual([]);
    expect(relativeConfigProblems({ anchor: "phase_start", phase_key: "ph_a", unit: "hours", offset_hours: 2 })).toEqual([]);
    expect(relativeConfigProblems({ anchor: "service_start", unit: "hours", offset_hours: 721 })).toEqual(["Las horas van de −720 a 720."]);
    expect(relativeConfigProblems({ anchor: "service_start", unit: "hours" })).toEqual(["Las horas van de −720 a 720."]);
    // Las horas no miran `offset_days` (el barrido diario no las toma).
    expect(relativeConfigProblems({ anchor: "service_start", unit: "hours", offset_days: 3 })).toEqual(["Las horas van de −720 a 720."]);
    expect(relativeConfigProblems({ anchor: "item_completed", item_key: "it_a", unit: "hours", offset_hours: -2 })).toHaveLength(1);
    expect(relativeConfigProblems({ anchor: "service_created", offset_days: -1 })).toHaveLength(1);
    expect(relativeConfigProblems({ anchor: "service_start", unit: "weeks" as never, offset_days: 1 })).toEqual(["Elegí días u horas."]);
    // Vacío no es 0.
    expect(relativeConfigProblems({ anchor: "service_start" })).toEqual(["Los días van de −365 a 365."]);
  });

  it("arma la frase en horas", () => {
    expect(relativeTriggerLabel({ anchor: "service_start", unit: "hours", offset_hours: -2 })).toBe("2 hora(s) antes del inicio del servicio");
    expect(relativeTriggerLabel({ anchor: "service_created", unit: "hours", offset_hours: 0 })).toBe("En el momento de la creación del servicio");
  });
});
