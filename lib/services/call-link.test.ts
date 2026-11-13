import { describe, expect, it } from "vitest";
import cases from "./call-link.cases.json";
import { callLinkPlan, isServiceMeeting, type CallLinkInput } from "./call-link";

describe("callLinkPlan (casos compartidos con svc_call_link_plan)", () => {
  it("tiene al menos 15 casos", () => {
    expect(cases.cases.length).toBeGreaterThanOrEqual(15);
  });
  for (const c of cases.cases) {
    it(c.name, () => {
      expect(callLinkPlan(c.input as CallLinkInput)).toEqual(c.expected);
    });
  }
});

describe("isServiceMeeting", () => {
  it("Servicio sí, Clase y Ventas no", () => {
    expect(isServiceMeeting("servicio", null)).toBe(true);
    expect(isServiceMeeting("servicio", "servicio.clase")).toBe(false);
    expect(isServiceMeeting("ventas", null)).toBe(false);
    expect(isServiceMeeting(null, "servicio.seguimiento")).toBe(true);
  });
});
