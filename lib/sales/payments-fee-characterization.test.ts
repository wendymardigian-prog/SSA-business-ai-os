/**
 * Caracterización del cobro con comisión DISTINTA de 0 (Extra I, MP). Hasta ahora los 5 métodos tenían
 * comisión 0, así que ningún test fijaba qué se congela al cobrar. Estos casos fijan el contrato que el
 * Extra I tiene que conservar: el total sale en céntimos exactos, el snapshot guarda la foto del método y
 * revertir limpia todo lo cobrado.
 */
import { describe, expect, it } from "vitest";
import { buildPaymentRows } from "./create";
import { planMarkPaid, REVERT_CLEARED_FIELDS } from "./payments-rules";
import { buildPaymentOptionSnapshot, computeProviderFee } from "./fees";

const stripe = { key: "stripe", name: "Stripe", feePercent: 2.9, feeFixed: 0.3 };
const ctx = { saleDate: "2026-10-01", todayLocal: "2026-10-11", timeZone: "America/Costa_Rica", now: new Date("2026-10-11T18:00:00Z"), enabledMethods: ["stripe", "wise"], methods: [stripe, { key: "wise", name: "Wise", feePercent: 0, feeFixed: 0 }] };
const scheduled = { type: "installment", status: "scheduled", amount: 500, due_date: "2026-10-15" };

describe("planMarkPaid con comisión", () => {
  it("un cobro de USD 500 al 2,9 % + 0,30 congela porcentaje, fijo y total (14,80)", () => {
    const r = planMarkPaid({ amount: 500, paidOn: "2026-10-11", method: "stripe" }, { ...ctx, payment: scheduled });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch).toMatchObject({ provider_fee_amount: 14.8, provider_fee_percent: 2.9, provider_fee_fixed: 0.3 });
    expect(r.patch.payment_option_snapshot).toEqual({ method_key: "stripe", method_name: "Stripe", provider_fee_percent: 2.9, provider_fee_fixed: 0.3 });
  });

  it("la comisión se calcula sobre lo que entró, no sobre lo programado", () => {
    const r = planMarkPaid({ amount: 350.5, paidOn: "2026-10-11", method: "stripe" }, { ...ctx, payment: scheduled });
    expect(r.ok && r.patch.provider_fee_amount).toBe(computeProviderFee(350.5, { pct: 2.9, fixed: 0.3 }));
  });

  it("un método sin comisión congela ceros, no nulls", () => {
    const r = planMarkPaid({ amount: 500, paidOn: "2026-10-11", method: "wise" }, { ...ctx, payment: scheduled });
    expect(r.ok && r.patch).toMatchObject({ provider_fee_amount: 0, provider_fee_percent: 0, provider_fee_fixed: 0 });
  });

  it("cambiar la comisión del método después NO cambia lo ya calculado (es un valor, no una referencia)", () => {
    const first = planMarkPaid({ amount: 500, paidOn: "2026-10-11", method: "stripe" }, { ...ctx, payment: scheduled });
    const later = planMarkPaid({ amount: 500, paidOn: "2026-10-11", method: "stripe" }, { ...ctx, methods: [{ ...stripe, feePercent: 5 }], payment: scheduled });
    expect(first.ok && first.patch.provider_fee_amount).toBe(14.8);
    expect(later.ok && later.patch.provider_fee_amount).toBe(25.3);
  });

  it("tres cobros de 416,67 al 3 % no pierden un céntimo", () => {
    const fee = computeProviderFee(416.67, { pct: 3, fixed: 0 });
    expect(Math.round(fee * 100) * 3).toBe(3750);
  });
});

describe("buildPaymentRows con comisión (alta de venta con pagos ya cobrados)", () => {
  it("lo cobrado lleva snapshot y total; lo programado no lleva ninguno", () => {
    const rows = buildPaymentRows(
      [
        { type: "reservation", amount: 500, status: "paid", date: "2026-10-11", method: "stripe" },
        { type: "installment", amount: 500, status: "scheduled", date: "2026-11-11" },
      ] as never,
      { timeZone: "America/Costa_Rica", now: ctx.now, methods: ctx.methods },
    );
    expect(rows[0]).toMatchObject({ status: "paid", provider_fee_amount: 14.8, payment_option_snapshot: buildPaymentOptionSnapshot("stripe", ctx.methods) });
    expect(rows[1]).not.toHaveProperty("provider_fee_amount");
    expect(rows[1]).not.toHaveProperty("payment_option_snapshot");
  });
});

describe("revertir un cobro", () => {
  it("limpia el total, el porcentaje, el fijo, el snapshot y el método", () => {
    expect(REVERT_CLEARED_FIELDS).toEqual({
      paid_at: null, paid_on: null,
      provider_fee_amount: null, provider_fee_percent: null, provider_fee_fixed: null,
      payment_option_snapshot: null, payment_method: null,
    });
  });
});
