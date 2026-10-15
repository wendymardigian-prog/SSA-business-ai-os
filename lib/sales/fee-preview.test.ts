import { describe, expect, it } from "vitest";
import { feePreviewText } from "./fee-preview";

describe("feePreviewText", () => {
  it("2,9 % + 0,30 sobre USD 1.000", () => {
    expect(feePreviewText({ pct: 2.9, fixed: 0.3 })).toBe("Con un cobro de USD 1.000,00 el procesador se queda USD 29,30 y entran USD 970,70.");
  });
  it("3 % + 2,30 (el ejemplo del plano) deja USD 967,70", () => {
    expect(feePreviewText({ pct: 3, fixed: 2.3 })).toContain("USD 967,70");
  });
  it("sin comisión lo dice", () => {
    expect(feePreviewText({ pct: 0, fixed: 0 })).toContain("no se queda nada");
  });
});
