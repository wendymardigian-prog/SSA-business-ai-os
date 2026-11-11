import { describe, expect, it } from "vitest";
import { splitPinned, stickyOffsets } from "./sticky";
import { sumCount, sumMoney } from "./totals";

describe("columnas fijas", () => {
  const cols = [{ key: "a" }, { key: "b" }, { key: "c" }];
  it("las fijas van en el orden en que se fijaron y solo las que se ven", () => {
    expect(splitPinned(cols, ["c", "ghost", "a"])).toEqual({ pinned: [{ key: "c" }, { key: "a" }], rest: [{ key: "b" }] });
    expect(splitPinned(cols, [])).toEqual({ pinned: [], rest: cols });
  });
  it("el offset de cada una suma los anchos de las anteriores", () => {
    expect(stickyOffsets([100, 80, 60])).toEqual([0, 100, 180]);
    expect(stickyOffsets([100, 80], 40)).toEqual([40, 140]);
  });
});

describe("totales", () => {
  it("suma plata en céntimos, sin errores de flotante", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney(["1200", 400.5, null, undefined])).toBe(1600.5);
    expect(sumMoney([100, -40])).toBe(60);
  });
  it("sin ningún dato es null, nunca 0", () => {
    expect(sumMoney([])).toBeNull();
    expect(sumMoney([null, undefined, ""])).toBeNull();
    expect(sumMoney([0])).toBe(0);
    expect(sumCount([null, Number.NaN])).toBeNull();
    expect(sumCount([2, 3, null])).toBe(5);
  });
});
