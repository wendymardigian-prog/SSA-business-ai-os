import { describe, expect, it } from "vitest";
import { partialOffer, planAddPayment, planFeeCorrection, planMarkPaid, planRefund, planReschedule, planRevert, planUncollectible, revertTarget } from "./payments-rules";

const ctx = { saleDate: "2026-10-01", todayLocal: "2026-10-11", timeZone: "America/Costa_Rica", now: new Date("2026-10-11T18:00:00Z"), enabledMethods: ["wise", "binance"] };
const scheduled = { type: "installment", status: "scheduled", amount: 500, due_date: "2026-10-15" };

describe("planMarkPaid", () => {
  it("congela método, snapshot y comisión", () => {
    const r = planMarkPaid({ amount: 500, paidOn: "2026-10-11", method: "wise" }, { ...ctx, payment: scheduled });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch).toMatchObject({ status: "paid", amount: 500, paid_on: "2026-10-11", payment_method: "wise", provider_fee_amount: 0 });
    expect(r.patch.payment_option_snapshot).toMatchObject({ method_key: "wise", method_name: "Wise" });
    expect(r.patch.paid_at).toBe("2026-10-11T18:00:00.000Z");
    expect(r.partial).toBeNull();
  });

  it("un monto menor deja el pago por lo real y OFRECE la diferencia a +30 días", () => {
    const r = planMarkPaid({ amount: 350.5, paidOn: "2026-10-11", method: "binance" }, { ...ctx, payment: scheduled });
    expect(r.ok && r.patch.amount).toBe(350.5);
    expect(r.ok && r.partial).toEqual({ difference: 149.5, suggestedDue: "2026-11-10" });
  });

  it("cobrar de más se permite y se avisa", () => {
    const r = planMarkPaid({ amount: 600, paidOn: "2026-10-11", method: "wise" }, { ...ctx, payment: scheduled });
    expect(r.ok && r.overpaidBy).toBe(100);
  });

  it("rechaza fecha anterior a la venta, futura, método deshabilitado y un pago ya cobrado", () => {
    const base = { amount: 500, paidOn: "2026-10-11", method: "wise" };
    expect(planMarkPaid({ ...base, paidOn: "2026-09-30" }, { ...ctx, payment: scheduled })).toMatchObject({ ok: false });
    expect(planMarkPaid({ ...base, paidOn: "2026-10-12" }, { ...ctx, payment: scheduled })).toMatchObject({ ok: false });
    expect(planMarkPaid({ ...base, method: "paypal" }, { ...ctx, payment: scheduled })).toMatchObject({ ok: false });
    expect(planMarkPaid({ ...base, method: "whop" }, { ...ctx, payment: scheduled })).toMatchObject({ ok: false });
    expect(planMarkPaid(base, { ...ctx, payment: { ...scheduled, status: "paid" } })).toMatchObject({ ok: false, error: "Este pago ya está cobrado" });
    expect(planMarkPaid({ ...base, amount: 0 }, { ...ctx, payment: scheduled })).toMatchObject({ ok: false });
  });

  it("un cobro de otro día lleva el mediodía local de esa fecha", () => {
    const r = planMarkPaid({ amount: 500, paidOn: "2026-10-05", method: "wise" }, { ...ctx, payment: scheduled });
    expect(r.ok && r.patch.paid_at).toBe("2026-10-05T18:00:00.000Z"); // 12:00 en Costa Rica
  });
});

describe("partialOffer", () => {
  it("solo si entró menos de lo programado", () => {
    expect(partialOffer(50000, 50000, "2026-10-11")).toBeNull();
    expect(partialOffer(50000, 30000, "2026-10-11")).toEqual({ difference: 200, suggestedDue: "2026-11-10" });
  });
});

describe("revertir", () => {
  it("un pago vencido hace 5 días vuelve moroso; uno futuro, programado (en la zona del workspace)", () => {
    expect(revertTarget({ due_date: "2026-10-06" }, "2026-10-11", 0)).toBe("overdue");
    expect(revertTarget({ due_date: "2026-10-20" }, "2026-10-11", 0)).toBe("scheduled");
    expect(revertTarget({ due_date: "2026-10-09" }, "2026-10-11", 3)).toBe("scheduled"); // dentro de la gracia
  });
  it("pide motivo y solo sirve sobre cobrado o incobrable", () => {
    const paid = { type: "installment", status: "paid", amount: 100, due_date: "2026-10-06" };
    expect(planRevert(paid, "se equivocaron", "2026-10-11", 0)).toEqual({ ok: true, target: "overdue" });
    expect(planRevert(paid, "  ", "2026-10-11", 0)).toMatchObject({ ok: false });
    expect(planRevert({ ...paid, status: "scheduled" }, "x", "2026-10-11", 0)).toMatchObject({ ok: false });
    expect(planRevert({ ...paid, type: "refund" }, "x", "2026-10-11", 0)).toMatchObject({ ok: false });
  });
});

describe("reprogramar", () => {
  const overdue = { type: "installment", status: "overdue", amount: 100, due_date: "2026-10-01" };
  it("un moroso a fecha futura vuelve a programado; a fecha pasada sigue moroso", () => {
    expect(planReschedule(overdue, { newDate: "2026-10-30", reason: "pidió más tiempo" }, "2026-10-11", 0)).toEqual({ ok: true, status: "scheduled" });
    expect(planReschedule(overdue, { newDate: "2026-10-05", reason: "x" }, "2026-10-11", 0)).toEqual({ ok: true, status: "overdue" });
  });
  it("sin motivo, sin fecha válida, igual a la actual o de un pago cobrado se rechaza", () => {
    expect(planReschedule(overdue, { newDate: "2026-10-30", reason: "" }, "2026-10-11", 0)).toMatchObject({ ok: false });
    expect(planReschedule(overdue, { newDate: "mañana", reason: "x" }, "2026-10-11", 0)).toMatchObject({ ok: false });
    expect(planReschedule(overdue, { newDate: "2026-10-01", reason: "x" }, "2026-10-11", 0)).toMatchObject({ ok: false });
    expect(planReschedule({ ...overdue, status: "paid" }, { newDate: "2026-10-30", reason: "x" }, "2026-10-11", 0)).toMatchObject({ ok: false });
  });
});

describe("incobrable", () => {
  it("solo un moroso y con motivo", () => {
    expect(planUncollectible({ type: "installment", status: "overdue", amount: 1, due_date: null }, "no responde")).toEqual({ ok: true });
    expect(planUncollectible({ type: "installment", status: "scheduled", amount: 1, due_date: null }, "x")).toMatchObject({ ok: false });
    expect(planUncollectible({ type: "installment", status: "overdue", amount: 1, due_date: null }, "")).toMatchObject({ ok: false });
  });
});

describe("planRefund", () => {
  const rctx = { netPaidCents: 80000, saleDate: "2026-10-01", todayLocal: "2026-10-11" };
  it("parcial y total", () => {
    expect(planRefund({ amount: 250, date: "2026-10-10", reason: "pidió la devolución" }, rctx)).toEqual({ ok: true, amountCents: 25000, total: false, scope: "partial" });
    expect(planRefund({ amount: 800, date: "2026-10-10", reason: "x" }, rctx)).toEqual({ ok: true, amountCents: 80000, total: true, scope: "total" });
  });
  it("no puede superar lo cobrado neto y dice el máximo", () => {
    const r = planRefund({ amount: 800.01, date: "2026-10-10", reason: "x" }, rctx);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain("800.00");
  });
  it("valida fecha, motivo y que haya algo cobrado", () => {
    expect(planRefund({ amount: 10, date: "2026-10-12", reason: "x" }, rctx)).toMatchObject({ ok: false });
    expect(planRefund({ amount: 10, date: "2026-09-30", reason: "x" }, rctx)).toMatchObject({ ok: false });
    expect(planRefund({ amount: 10, date: "2026-10-10", reason: "" }, rctx)).toMatchObject({ ok: false });
    expect(planRefund({ amount: 10, date: "2026-10-10", reason: "x" }, { ...rctx, netPaidCents: 0 })).toMatchObject({ ok: false });
  });
});

describe("planAddPayment", () => {
  it("monto positivo, fecha válida y método habilitado", () => {
    expect(planAddPayment({ amount: 120.5, dueDate: "2026-11-10", method: "wise" }, ["wise"])).toEqual({ ok: true, amount: 120.5 });
    expect(planAddPayment({ amount: 0, dueDate: "2026-11-10" }, ["wise"])).toMatchObject({ ok: false });
    expect(planAddPayment({ amount: 10, dueDate: "x" }, ["wise"])).toMatchObject({ ok: false });
    expect(planAddPayment({ amount: 10, dueDate: "2026-11-10", method: "binance" }, ["wise"])).toMatchObject({ ok: false });
  });
});

describe("planFeeCorrection (Extra I, F6)", () => {
  const paid = { type: "installment", status: "paid", amount: 500 };
  it("corrige a un monto de cero hasta lo cobrado, con motivo", () => {
    expect(planFeeCorrection(paid, { feeAmount: 12.5, reason: "el procesador cobró de más" })).toEqual({ ok: true, feeAmount: 12.5 });
    expect(planFeeCorrection(paid, { feeAmount: 0, reason: "sin cargo" })).toEqual({ ok: true, feeAmount: 0 });
  });
  it("rechaza un monto mayor al pago, negativo o vacío, y un motivo vacío", () => {
    expect(planFeeCorrection(paid, { feeAmount: 500.01, reason: "x" })).toMatchObject({ ok: false });
    expect(planFeeCorrection(paid, { feeAmount: -1, reason: "x" })).toMatchObject({ ok: false });
    expect(planFeeCorrection(paid, { feeAmount: "", reason: "x" })).toMatchObject({ ok: false });
    expect(planFeeCorrection(paid, { feeAmount: 5, reason: "  " })).toMatchObject({ ok: false });
  });
  it("solo un cobro que no es reembolso", () => {
    expect(planFeeCorrection({ ...paid, status: "scheduled" }, { feeAmount: 1, reason: "x" })).toMatchObject({ ok: false });
    expect(planFeeCorrection({ ...paid, type: "refund" }, { feeAmount: 1, reason: "x" })).toMatchObject({ ok: false });
  });
});
