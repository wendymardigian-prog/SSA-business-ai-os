import { describe, expect, it } from "vitest";
import cases from "./lock.cases.json";
import { lockErrorMessage, lockLabel, lockPlan, readLock, type LockPlanInput } from "./lock";

describe("lockPlan (casos compartidos con svc_lock_plan)", () => {
  it("tiene al menos 12 casos", () => {
    expect(cases.cases.length).toBeGreaterThanOrEqual(12);
  });
  for (const c of cases.cases) {
    it(c.name, () => {
      expect(lockPlan(c.input as LockPlanInput)).toEqual(c.expected);
    });
  }
});

describe("frases del candado", () => {
  const fmt = (d: string) => d.split("-").reverse().slice(0, 2).join("/");
  it("dice desde cuándo o después de qué paso", () => {
    expect(lockLabel({ locked: true, until: "2026-11-13", waiting_item_key: null }, {}, fmt)).toBe("Desde el 13/11");
    expect(lockLabel({ locked: true, until: null, waiting_item_key: "it_a" }, { it_a: "Configurar cuenta" }, fmt)).toBe("Después de: Configurar cuenta");
    expect(lockLabel({ locked: false, until: null, waiting_item_key: null }, {}, fmt)).toBeNull();
    expect(lockErrorMessage({ locked: true, until: "2026-11-13", waiting_item_key: null }, {}, fmt)).toBe("Este paso se puede completar desde el 13/11.");
  });
  it("lee solo formas válidas", () => {
    expect(readLock({ from: "phase_start", days: "3" })).toEqual({ from: "phase_start", days: 3 });
    expect(readLock({ from: "x", days: 3 })).toBeNull();
    expect(readLock("nada")).toBeNull();
  });
});
