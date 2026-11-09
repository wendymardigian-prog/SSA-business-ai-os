// @plantilla-quitar(ventas)
import { describe, expect, it } from "vitest";
import cases from "./affiliate-assign.cases.json";
import { planAffiliateAssignment, resolveAffiliateSettings, type AssignInput } from "./assign";

describe("planAffiliateAssignment (casos compartidos con la base)", () => {
  it("son por lo menos 14", () => expect(cases.cases.length).toBeGreaterThanOrEqual(14));
  for (const c of cases.cases) {
    it(c.name, () => {
      expect(planAffiliateAssignment(c.input as unknown as AssignInput)).toEqual(c.expected);
    });
  }
});

describe("los defaults", () => {
  it("{} = lo trajo 12 meses, influyó 90 días con renovacion, la vigente se queda", () => {
    expect(resolveAffiliateSettings({})).toEqual({ originatedMonths: 12, originatedReplace: "keep", influencedDays: 90, renewOnClick: true, influencedReplace: "keep", firstPurchaseOnly: false });
  });
});
