import { describe, expect, it } from "vitest";
import { DEFAULT_EXPENSE_CATEGORIES } from "./categories";
import { defaultFinanceSettings } from "./settings";
import { planAutoSettings, type AutoSettingInput, type AutoSettingsContext } from "./auto-settings";

const ctx: AutoSettingsContext = {
  methods: [{ key: "whop", name: "Whop (registrado a mano)" }, { key: "wise", name: "Wise" }],
  metaAccounts: [{ id: "act_1", name: "Cuenta USD", currency: "USD" }, { id: "act_2", name: "Cuenta EUR", currency: "EUR" }],
  categories: DEFAULT_EXPENSE_CATEGORIES,
};
const row = (over: Partial<AutoSettingInput> = {}): AutoSettingInput => ({ key: "whop", enabled: true, chargeMode: "automatic", categoryKey: null, vendorId: null, ...over });
const input = (over: Partial<Parameters<typeof planAutoSettings>[0]> = {}) => ({ processorFees: [], metaAds: [], autoCloseDays: 3, ...over });

describe("planAutoSettings", () => {
  it("rechaza un método que no existe", () => {
    const r = planAutoSettings(input({ processorFees: [row({ key: "cripto" })] }), defaultFinanceSettings(), ctx);
    expect(r).toEqual({ ok: false, error: "Ese método de pago no existe" });
  });

  it("encender Whop sin proveedor pide crear/reusar «Whop» (sin el paréntesis)", () => {
    const r = planAutoSettings(input({ processorFees: [row()] }), defaultFinanceSettings(), ctx);
    expect(r.ok && r.plan.needsVendor).toEqual([{ section: "processor_fees", key: "whop", name: "Whop" }]);
  });

  it("con proveedor elegido no pide ninguno", () => {
    const vendorId = "11111111-1111-4111-8111-111111111111";
    const r = planAutoSettings(input({ processorFees: [row({ vendorId })] }), defaultFinanceSettings(), ctx);
    expect(r.ok && r.plan.needsVendor).toEqual([]);
  });

  it("una cuenta de Meta en otra moneda no se puede encender, pero sí dejar apagada", () => {
    const on = planAutoSettings(input({ metaAds: [row({ key: "act_2" })] }), defaultFinanceSettings(), ctx);
    expect(on.ok).toBe(false);
    const off = planAutoSettings(input({ metaAds: [row({ key: "act_2", enabled: false })] }), defaultFinanceSettings(), ctx);
    expect(off.ok).toBe(true);
  });

  it("la cuenta de Meta en USD pide el proveedor «Meta»", () => {
    const r = planAutoSettings(input({ metaAds: [row({ key: "act_1" })] }), defaultFinanceSettings(), ctx);
    expect(r.ok && r.plan.needsVendor).toEqual([{ section: "meta_ads", key: "act_1", name: "Meta" }]);
  });

  it("apagar conserva la configuración y lo que no vino en el pedido queda como estaba", () => {
    const current = { ...defaultFinanceSettings(), processor_fees: { wise: { enabled: true, vendor_id: null, category_key: null, charge_mode: "manual" as const } } };
    const r = planAutoSettings(input({ processorFees: [row({ enabled: false })] }), current, ctx);
    expect(r.ok && r.plan.processor_fees).toEqual({
      wise: { enabled: true, vendor_id: null, category_key: null, charge_mode: "manual" },
      whop: { enabled: false, vendor_id: null, category_key: null, charge_mode: "automatic" },
    });
    expect(r.ok && r.plan.needsVendor).toEqual([]);
  });

  it("valida los días de cierre (0 a 10), la categoría y los repetidos", () => {
    expect(planAutoSettings(input({ autoCloseDays: 11 }), defaultFinanceSettings(), ctx).ok).toBe(false);
    expect(planAutoSettings(input({ autoCloseDays: "" }), defaultFinanceSettings(), ctx).ok).toBe(false);
    expect(planAutoSettings(input({ processorFees: [row({ categoryKey: "no_existe" })] }), defaultFinanceSettings(), ctx).ok).toBe(false);
    expect(planAutoSettings(input({ processorFees: [row(), row()] }), defaultFinanceSettings(), ctx).ok).toBe(false);
    expect(planAutoSettings(input({ autoCloseDays: 0 }), defaultFinanceSettings(), ctx).ok).toBe(true);
  });
});
