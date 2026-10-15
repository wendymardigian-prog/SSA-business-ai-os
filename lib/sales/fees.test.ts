import { describe, expect, it } from "vitest";
import { buildPaymentOptionSnapshot, computeProviderFee, feeBreakdown } from "./fees";
import { DEFAULT_ENABLED_PAYMENT_METHODS, PAYMENT_METHODS, PAYMENT_METHOD_KEYS, isPaymentMethodKey, paymentMethodName, scheduledUsingDisabled, selectableMethods } from "./payment-methods";

describe("computeProviderFee", () => {
  it("100 con 3 % da 3.00 (comisión explícita; la de Whop está en 0 hasta que se confirme)", () => {
    expect(computeProviderFee(100, { pct: 3, fixed: 0 })).toBe(3);
  });

  it("416.67 con 2,9 % + 0,30 da 12.38 (en céntimos, no 12.383…)", () => {
    expect(computeProviderFee(416.67, { pct: 2.9, fixed: 0.3 })).toBe(12.38);
  });

  it("wise (y los métodos sin comisión) dan 0", () => {
    expect(computeProviderFee(100, "wise")).toBe(0);
    expect(computeProviderFee(1297.33, "transferencia_cr")).toBe(0);
  });

  it("whop está en 0 % hasta confirmar el valor real", () => {
    expect(computeProviderFee(100, "whop")).toBe(0);
  });

  it("un monto cero, negativo o inválido no tiene comisión", () => {
    expect(computeProviderFee(0, { pct: 3, fixed: 1 })).toBe(0);
    expect(computeProviderFee(-50, { pct: 3, fixed: 1 })).toBe(0);
    expect(computeProviderFee("x", { pct: 3, fixed: 1 })).toBe(0);
    expect(computeProviderFee(100, "no-existe")).toBe(0);
  });
});

describe("snapshot del método", () => {
  it("guarda nombre y comisiones del momento", () => {
    expect(buildPaymentOptionSnapshot("wise")).toEqual({
      method_key: "wise",
      method_name: "Wise",
      provider_fee_percent: 0,
      provider_fee_fixed: 0,
    });
    expect(buildPaymentOptionSnapshot("nada")).toBeNull();
  });
});

describe("métodos de pago", () => {
  it("son los cinco del plano, en orden", () => {
    expect(PAYMENT_METHOD_KEYS).toEqual(["whop", "transferencia_cr", "transferencia_usa", "wise", "binance"]);
    expect(PAYMENT_METHODS).toHaveLength(5);
    expect(DEFAULT_ENABLED_PAYMENT_METHODS).toEqual(PAYMENT_METHOD_KEYS);
  });

  it("isPaymentMethodKey y paymentMethodName", () => {
    expect(isPaymentMethodKey("wise")).toBe(true);
    expect(isPaymentMethodKey("paypal")).toBe(false);
    expect(paymentMethodName("wise")).toBe("Wise");
    expect(paymentMethodName("paypal")).toBe("paypal");
    expect(paymentMethodName(null)).toBe("—");
  });

  it("el selector ofrece solo los habilitados, pero conserva el que ya usa un pago", () => {
    expect(selectableMethods(["wise"]).map((m) => m.key)).toEqual(["wise"]);
    expect(selectableMethods(["wise"], "binance").map((m) => m.key)).toEqual(["wise", "binance"]);
    expect(selectableMethods(null)).toHaveLength(5);
  });

  it("cuenta los pagos programados que usan un método deshabilitado", () => {
    expect(scheduledUsingDisabled(["wise", "binance", "binance", null], ["wise"])).toEqual({ binance: 2 });
  });
});

describe("paridad con el CHECK de payments.payment_method (00162)", () => {
  it("las claves de la migración son exactamente las de la constante", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/00162_sales_payments.sql", "utf8");
    const check = sql.match(/payments_method_check\s+CHECK \(payment_method IS NULL OR payment_method IN \(([^)]*)\)\)/);
    expect(check).not.toBeNull();
    const keys = [...(check![1].matchAll(/'([a-z_]+)'/g))].map((m) => m[1]);
    expect(keys).toEqual([...PAYMENT_METHOD_KEYS]);
  });
});

describe("Extra I, MP: tope, desglose y lista del negocio", () => {
  it("la comisión nunca supera el monto cobrado", () => {
    expect(computeProviderFee(0.1, { pct: 2.9, fixed: 0.3 })).toBe(0.1);
    expect(computeProviderFee(0.2, { pct: 0, fixed: 5 })).toBe(0.2);
  });

  it("2,9 % + 0,30 sobre 1.000 da 29,30", () => {
    expect(computeProviderFee(1000, { pct: 2.9, fixed: 0.3 })).toBe(29.3);
  });

  it("un porcentaje con tres decimales no pasa por el flotante: 2,125 % de 416,67", () => {
    // 41667 × 2125 / 100000 = 885,4… → 885 céntimos
    expect(computeProviderFee(416.67, { pct: 2.125, fixed: 0 })).toBe(8.85);
  });

  it("feeBreakdown de 416,67 al 3 % da fee 12,50 y neto 404,17 en céntimos exactos", () => {
    expect(feeBreakdown(416.67, { pct: 3, fixed: 0 })).toEqual({ feePercentCents: 1250, feeFixedCents: 0, feeTotal: 1250, net: 40417 });
  });

  it("el desglose separa porcentaje y fijo y respeta el tope", () => {
    expect(feeBreakdown(500, { pct: 2.9, fixed: 0.3 })).toEqual({ feePercentCents: 1450, feeFixedCents: 30, feeTotal: 1480, net: 48520 });
    expect(feeBreakdown(0.1, { pct: 2.9, fixed: 0.3 })).toMatchObject({ feeTotal: 10, net: 0 });
    expect(feeBreakdown(0, { pct: 3, fixed: 1 })).toEqual({ feePercentCents: 0, feeFixedCents: 0, feeTotal: 0, net: 0 });
  });

  it("tres cobros de 416,67 al 3 %: la suma de comisiones es la suma de los céntimos", () => {
    const one = feeBreakdown(416.67, { pct: 3, fixed: 0 }).feeTotal;
    expect(one * 3).toBe(3750);
  });

  it("con la lista del negocio, el método viene de ahí y no del catálogo de arranque", () => {
    const catalog = [{ key: "stripe", name: "Stripe", feePercent: 2.9, feeFixed: 0.3 }];
    expect(computeProviderFee(500, "stripe", catalog)).toBe(14.8);
    expect(computeProviderFee(500, "wise", catalog)).toBe(0); // no está en la lista
    expect(buildPaymentOptionSnapshot("stripe", catalog)).toEqual({ method_key: "stripe", method_name: "Stripe", provider_fee_percent: 2.9, provider_fee_fixed: 0.3 });
    expect(buildPaymentOptionSnapshot("wise", catalog)).toBeNull();
  });
});
