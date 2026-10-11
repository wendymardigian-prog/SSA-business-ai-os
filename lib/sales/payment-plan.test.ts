import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { balanceLine, bornOverdue, buildPaymentPlan, dueDateAt, firstPaymentType, splitCents, validatePlanBalances } from "./payment-plan";
import { formatMoney } from "./format";

describe("buildPaymentPlan", () => {
  it("1250, primer pago de 250 cobrado y 4 cuotas mensuales → 5 pagos", () => {
    const plan = buildPaymentPlan({
      total: 1250, financing: "installments", first: { amount: 250, paid: true, date: "2026-10-11", method: "wise" },
      installments: 4, frequency: "monthly", firstDue: "2026-10-26",
    });
    expect(plan).toHaveLength(5);
    expect(plan[0]).toMatchObject({ type: "installment", amount: 250, status: "paid", paid_on: "2026-10-11", payment_method: "wise" });
    expect(plan.slice(1).map((p) => [p.amount, p.due_date, p.status])).toEqual([
      [250, "2026-10-26", "scheduled"], [250, "2026-11-26", "scheduled"], [250, "2026-12-26", "scheduled"], [250, "2027-01-26", "scheduled"],
    ]);
  });

  it("1250 sin primer pago y 3 cuotas → 416,67 · 416,67 · 416,66, y suman exacto", () => {
    const plan = buildPaymentPlan({ total: 1250, financing: "installments", first: { amount: 0, paid: false, date: "2026-10-11" }, installments: 3, frequency: "monthly", firstDue: "2026-10-26" });
    expect(plan.map((p) => p.amount)).toEqual([416.67, 416.67, 416.66]);
    expect(validatePlanBalances(1250, plan)).toEqual({ ok: true, diffCents: 0 });
  });

  it("mensual desde el 31 de enero cae el 28 (o 29) de febrero y el 31 de marzo", () => {
    expect(dueDateAt("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(dueDateAt("2028-01-31", "monthly", 1)).toBe("2028-02-29");
    expect(dueDateAt("2026-01-31", "monthly", 2)).toBe("2026-03-31");
  });

  it("semanal y quincenal", () => {
    expect(dueDateAt("2026-10-01", "weekly", 2)).toBe("2026-10-15");
    expect(dueDateAt("2026-10-01", "biweekly", 2)).toBe("2026-10-29");
  });

  it("pago completo: un solo pago por el total", () => {
    const plan = buildPaymentPlan({ total: 1297.33, financing: "full", first: { amount: 0, paid: true, date: "2026-10-11" }, frequency: "monthly", firstDue: "2026-10-11" });
    expect(plan).toEqual([{ type: "full", amount: 1297.33, status: "paid", due_date: "2026-10-11", paid_on: "2026-10-11", payment_method: null }]);
  });

  it("reserva + saldo: la reserva y un pago por el resto", () => {
    const plan = buildPaymentPlan({ total: 1297, financing: "reservation_balance", first: { amount: 297, paid: true, date: "2026-10-11" }, frequency: "monthly", firstDue: "2026-11-11" });
    expect(plan.map((p) => [p.type, p.amount, p.status])).toEqual([["reservation", 297, "paid"], ["installment", 1000, "scheduled"]]);
  });

  it("reserva + cuotas por monto: la última cuota absorbe lo que sobra", () => {
    const plan = buildPaymentPlan({ total: 1000, financing: "reservation_installments", first: { amount: 100, paid: false, date: "2026-10-20" }, installmentAmount: 400, frequency: "monthly", firstDue: "2026-11-01" });
    expect(plan.map((p) => p.amount)).toEqual([100, 400, 400, 100]);
    expect(validatePlanBalances(1000, plan).ok).toBe(true);
  });

  it("suscripción: un pago, sin cuadre", () => {
    const plan = buildPaymentPlan({ total: 99, financing: "subscription", first: { amount: 99, paid: false, date: "2026-10-20" }, frequency: "monthly", firstDue: "2026-10-20" });
    expect(plan).toHaveLength(1);
  });

  it("un primer pago que ya cubre el total no deja cuotas", () => {
    const plan = buildPaymentPlan({ total: 500, financing: "installments", first: { amount: 500, paid: true, date: "2026-10-11" }, installments: 3, frequency: "monthly", firstDue: "2026-11-11" });
    expect(plan).toHaveLength(1);
  });
});

describe("splitCents / firstPaymentType", () => {
  it("reparte los céntimos que sobran a las primeras", () => {
    expect(splitCents(125000, 3)).toEqual([41667, 41667, 41666]);
    expect(splitCents(100, 3).reduce((a, b) => a + b, 0)).toBe(100);
    expect(splitCents(100, 0)).toEqual([]);
  });
  it("el tipo del primer pago sale del financiamiento", () => {
    expect(firstPaymentType("full")).toBe("full");
    expect(firstPaymentType("reservation_installments")).toBe("reservation");
    expect(firstPaymentType("installments")).toBe("installment");
  });
});

describe("validatePlanBalances", () => {
  it("1296,99 contra 1297 → falta 1 céntimo", () => {
    expect(validatePlanBalances(1297, [{ amount: 1296.99 }])).toEqual({ ok: false, diffCents: 1 });
  });
  it("un reembolso no cuenta para el cuadre", () => {
    expect(validatePlanBalances(100, [{ amount: 100 }, { amount: -30, type: "refund" }]).ok).toBe(true);
  });
  it("no se compara con === sobre flotantes: 0.1 + 0.2 contra 0.3 cuadra", () => {
    expect(validatePlanBalances(0.3, [{ amount: 0.1 }, { amount: 0.2 }]).ok).toBe(true);
  });
});

describe("balanceLine", () => {
  it("dice la diferencia exacta", () => {
    expect(balanceLine(1297, [{ amount: 1297 }], formatMoney)).toBe("Asignado $1.297,00 de $1.297,00");
    expect(balanceLine(1297, [{ amount: 1000 }], formatMoney)).toBe("Falta asignar $297,00");
    expect(balanceLine(1297, [{ amount: 1300.5 }], formatMoney)).toBe("Te pasaste por $3,50");
  });
});

describe("bornOverdue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("avisa de las cuotas programadas con vencimiento anterior a hoy", () => {
    expect(bornOverdue([{ status: "scheduled", due_date: "2026-10-01" }, { status: "scheduled", due_date: "2026-10-11" }, { status: "paid", due_date: "2026-09-01" }], "2026-10-11")).toEqual([0]);
  });
});
