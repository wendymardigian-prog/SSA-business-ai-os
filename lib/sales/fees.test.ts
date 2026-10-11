import { describe, expect, it } from "vitest";
import { buildPaymentOptionSnapshot, computeProviderFee } from "./fees";
import { DEFAULT_ENABLED_PAYMENT_METHODS, PAYMENT_METHODS, PAYMENT_METHOD_KEYS, isPaymentMethodKey, paymentMethodName, scheduledUsingDisabled, selectableMethods } from "./payment-methods";

describe("computeProviderFee", () => {
  it("100 con 3 % da 3.00 (comisión explícita; la de Whop está en 0 hasta que Wendy confirme)", () => {
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
