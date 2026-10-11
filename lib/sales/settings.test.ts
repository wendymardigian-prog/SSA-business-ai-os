import { describe, expect, it } from "vitest";
import { checkGraceDays, checkMaxDiscountPercent } from "./settings";

describe("tope de descuento y días de gracia", () => {
  it("el tope: vacío = sin tope, de 0 a 100, con dos decimales", () => {
    expect(checkMaxDiscountPercent("")).toEqual({ ok: true, value: null });
    expect(checkMaxDiscountPercent(null)).toEqual({ ok: true, value: null });
    expect(checkMaxDiscountPercent("12.345")).toEqual({ ok: true, value: 12.35 });
    expect(checkMaxDiscountPercent(0)).toEqual({ ok: true, value: 0 });
    expect(checkMaxDiscountPercent(101)).toMatchObject({ ok: false });
    expect(checkMaxDiscountPercent(-1)).toMatchObject({ ok: false });
    expect(checkMaxDiscountPercent("abc")).toMatchObject({ ok: false });
  });
  it("los días de gracia: entero de 0 a 60", () => {
    expect(checkGraceDays("3")).toEqual({ ok: true, value: 3 });
    expect(checkGraceDays(0)).toEqual({ ok: true, value: 0 });
    for (const bad of ["", null, undefined, 1.5, -1, 61, "x"]) expect(checkGraceDays(bad), String(bad)).toMatchObject({ ok: false });
  });
});
