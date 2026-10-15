import { describe, expect, it } from "vitest";
import { checkAutoCloseDays, defaultFinanceSettings, parseFinanceSettings } from "./settings";

describe("parseFinanceSettings", () => {
  it("sin nada válido devuelve los valores por defecto y nunca lanza", () => {
    for (const bad of [null, undefined, "x", [], 4]) {
      const s = parseFinanceSettings(bad);
      expect(s.expense_categories).toHaveLength(12);
      expect(s.auto_close_days).toBe(3);
      expect(s.processor_fees).toEqual({});
    }
  });
  it("lee los automáticos por método y por cuenta; descarta lo roto", () => {
    const s = parseFinanceSettings({
      processor_fees: { whop: { enabled: true, vendor_id: null, category_key: "processor_fees", charge_mode: "automatic" }, roto: { enabled: "sí" } },
      meta_ads: { act_1: { enabled: false } },
      auto_close_days: 5,
    });
    expect(Object.keys(s.processor_fees)).toEqual(["whop"]);
    expect(s.meta_ads.act_1).toMatchObject({ enabled: false, charge_mode: "automatic", vendor_id: null });
    expect(s.auto_close_days).toBe(5);
  });
  it("días de cierre fuera de 0 a 10 vuelven a 3", () => {
    expect(parseFinanceSettings({ auto_close_days: 11 }).auto_close_days).toBe(3);
    expect(parseFinanceSettings({ auto_close_days: -1 }).auto_close_days).toBe(3);
  });
  it("el default tiene las 12 categorías", () => {
    expect(defaultFinanceSettings().expense_categories).toHaveLength(12);
  });
});

describe("checkAutoCloseDays", () => {
  it("entero de 0 a 10", () => {
    expect(checkAutoCloseDays(0)).toEqual({ ok: true, value: 0 });
    expect(checkAutoCloseDays("7")).toEqual({ ok: true, value: 7 });
    expect(checkAutoCloseDays(11)).toMatchObject({ ok: false });
    expect(checkAutoCloseDays("")).toMatchObject({ ok: false });
    expect(checkAutoCloseDays(2.5)).toMatchObject({ ok: false });
  });
});
