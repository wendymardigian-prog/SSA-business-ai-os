import { describe, expect, it } from "vitest";
import { paymentRows, rowActions, tableFooter, type TablePayment } from "./payment-table";

const pay = (over: Partial<TablePayment> = {}): TablePayment => ({
  id: "p", type: "installment", status: "scheduled", amount: 500, due_date: "2026-10-30", original_due_date: "2026-10-30", paid_on: null,
  delay_days: null, payment_method: null, provider_fee_amount: null, receipt_path: null, reschedule_count: 0, notes: null, ...over,
});

describe("filas de la tabla", () => {
  it("un pago reprogramado muestra la nueva y la original entre paréntesis", () => {
    const [row] = paymentRows([pay({ due_date: "2026-11-15", original_due_date: "2026-10-30", reschedule_count: 1 })], true);
    expect(row.due).toEqual({ current: "2026-11-15", original: "2026-10-30" });
    expect(paymentRows([pay()], true)[0].due.original).toBeNull();
  });
  it("el desfase 0 dice «puntual» y solo se muestra en lo cobrado", () => {
    const [paid] = paymentRows([pay({ status: "paid", delay_days: 0, paid_on: "2026-10-30" })], true);
    expect(paid.delay.label).toBe("puntual");
    expect(paymentRows([pay({ delay_days: 4 })], true)[0].delay.label).toBe("—");
  });
  it("un cobro con comisión muestra el total, lo que se congeló y el neto (Extra I)", () => {
    const [row] = paymentRows([pay({ status: "paid", amount: 500, provider_fee_amount: 14.8, provider_fee_percent: 2.9, provider_fee_fixed: 0.3 })], true);
    expect(row).toMatchObject({ fee: 14.8, feeNote: "2,9 % + 0,30", net: 485.2 });
  });
  it("un cobro sin el desglose (anterior al Extra I) muestra el total pero no la nota; sin comisión no hay fee ni nota", () => {
    expect(paymentRows([pay({ status: "paid", amount: 500, provider_fee_amount: 14.8 })], true)[0]).toMatchObject({ fee: 14.8, feeNote: null, net: 485.2 });
    expect(paymentRows([pay({ status: "paid", amount: 500, provider_fee_amount: 0, provider_fee_percent: 0, provider_fee_fixed: 0 })], true)[0]).toMatchObject({ fee: null, feeNote: null, net: 500 });
    expect(paymentRows([pay({ status: "scheduled" })], true)[0].net).toBeNull();
  });
  it("el nombre del método sale de la lista del negocio", () => {
    const catalog = [{ key: "stripe", name: "Stripe", feePercent: 2.9, feeFixed: 0.3 }];
    expect(paymentRows([pay({ status: "paid", payment_method: "stripe" })], true, catalog)[0].method).toBe("Stripe");
  });
  it("la comisión solo aparece en lo cobrado y mayor que cero", () => {
    expect(paymentRows([pay({ status: "paid", provider_fee_amount: 14.5 })], true)[0].fee).toBe(14.5);
    expect(paymentRows([pay({ status: "paid", provider_fee_amount: 0 })], true)[0].fee).toBeNull();
  });
});

describe("acciones por fila", () => {
  it("sin payments.manage no hay acciones (salvo ver un comprobante que existe)", () => {
    expect(rowActions({ status: "overdue", type: "installment", receipt_path: null }, false)).toEqual({ markPaid: false, reschedule: false, uncollectible: false, revert: false, receipt: null });
    expect(rowActions({ status: "paid", type: "installment", receipt_path: "ws/s/p/f.pdf" }, false).receipt).toBe("view");
  });
  it("cada estado ofrece lo suyo", () => {
    expect(rowActions({ status: "scheduled", type: "installment", receipt_path: null }, true)).toMatchObject({ markPaid: true, reschedule: true, uncollectible: false, revert: false });
    expect(rowActions({ status: "overdue", type: "installment", receipt_path: null }, true)).toMatchObject({ markPaid: true, reschedule: true, uncollectible: true });
    expect(rowActions({ status: "paid", type: "installment", receipt_path: null }, true)).toMatchObject({ markPaid: false, revert: true, receipt: "upload" });
    expect(rowActions({ status: "uncollectible", type: "installment", receipt_path: null }, true)).toMatchObject({ revert: true, markPaid: false });
    expect(rowActions({ status: "cancelled", type: "installment", receipt_path: null }, true)).toMatchObject({ markPaid: false, revert: false });
    expect(rowActions({ status: "paid", type: "refund", receipt_path: null }, true)).toMatchObject({ revert: false, markPaid: false });
  });
});

describe("pie de la tabla", () => {
  it("el saldo no cuadrado se pinta en rojo, salvo en una suscripción", () => {
    const payments = [pay({ status: "paid", amount: 300 }), pay({ amount: 500 })];
    expect(tableFooter(1297, payments, false)).toMatchObject({ final: 1297, paid: 300, balance: 997, balanceRed: true, overpaidBy: 0, expected: 500 });
    expect(tableFooter(1297, payments, true).balanceRed).toBe(false);
    expect(tableFooter(300, [pay({ status: "paid", amount: 300 })], false).balanceRed).toBe(false);
  });
  it("cobrado de más: avisa por cuánto", () => {
    expect(tableFooter(300, [pay({ status: "paid", amount: 350 })], false)).toMatchObject({ balance: -50, overpaidBy: 50, balanceRed: true });
  });
});
