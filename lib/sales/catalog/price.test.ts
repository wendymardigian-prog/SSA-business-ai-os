import { describe, expect, it } from "vitest";
import { checkPrice, hasPrice, priceOrNull } from "./price";

describe("checkPrice", () => {
  it("acepta un precio con coma o punto y lo deja en dos decimales", () => {
    expect(checkPrice("1297,5")).toEqual({ ok: true, price: 1297.5 });
    expect(checkPrice(416.67)).toEqual({ ok: true, price: 416.67 });
    expect(checkPrice(" 3000 ")).toEqual({ ok: true, price: 3000 });
  });
  it("el cero es válido: significa 'sin precio'", () => {
    expect(checkPrice(0)).toEqual({ ok: true, price: 0 });
  });
  it("rechaza vacío, negativo, texto y un precio absurdo", () => {
    expect(checkPrice("")).toMatchObject({ ok: false });
    expect(checkPrice(null)).toMatchObject({ ok: false });
    expect(checkPrice(-5)).toMatchObject({ ok: false });
    expect(checkPrice("abc")).toMatchObject({ ok: false });
    expect(checkPrice(10_000_001)).toMatchObject({ ok: false });
  });
});

describe("hasPrice / priceOrNull", () => {
  it("cero, vacío y basura son 'sin precio'", () => {
    for (const v of [0, "0", "0.00", null, undefined, "x"]) {
      expect(hasPrice(v)).toBe(false);
      expect(priceOrNull(v)).toBeNull();
    }
  });
  it("un precio positivo se devuelve a dos decimales", () => {
    expect(hasPrice("3000.00")).toBe(true);
    expect(priceOrNull("3000.00")).toBe(3000);
    expect(priceOrNull(0.1 + 0.2)).toBe(0.3);
  });
});
