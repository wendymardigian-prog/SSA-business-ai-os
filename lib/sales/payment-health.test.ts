import { describe, expect, it } from "vitest";
import { computePaymentHealth, describePaymentHealth } from "./payment-health";

const paid = (delay: number) => ({ type: "installment", status: "paid", amount: 100, delay_days: delay });

describe("computePaymentHealth", () => {
  it("5 puntuales y 2 de +3 días: promedio de todos a un decimal", () => {
    const h = computePaymentHealth([...Array(5).fill(0).map(() => paid(0)), paid(3), paid(3)]);
    expect(h).toEqual({ on_time: 5, late: 2, early: 0, avg_delay_days: 0.9, has_active_overdue: false, total_paid: 7 });
  });
  it("cuenta adelantados, ignora reembolsos y pagos sin desfase", () => {
    const h = computePaymentHealth([paid(-2), { type: "refund", status: "paid", amount: -50, delay_days: 0 }, { type: "installment", status: "scheduled", amount: 100, delay_days: null }]);
    expect(h).toMatchObject({ early: 1, on_time: 0, total_paid: 1, avg_delay_days: -2 });
  });
  it("hay mora activa mientras exista un pago moroso", () => {
    expect(computePaymentHealth([paid(0), { type: "installment", status: "overdue", amount: 100, delay_days: null }]).has_active_overdue).toBe(true);
    expect(computePaymentHealth([paid(0)]).has_active_overdue).toBe(false);
  });
});

describe("describePaymentHealth", () => {
  it("lo que se lee en la ficha del contacto", () => {
    expect(describePaymentHealth({ on_time: 5, late: 2, early: 0, avg_delay_days: 3, has_active_overdue: false, total_paid: 7 })).toBe("7 pagos: 5 puntuales, 2 tarde · promedio +3 días · sin mora activa");
    expect(describePaymentHealth({ on_time: 1, late: 0, early: 0, avg_delay_days: 0, has_active_overdue: true, total_paid: 1 })).toBe("1 pago: 1 puntual · promedio 0 días · con mora activa");
  });
  it("sin pagos ni mora no dice nada", () => {
    expect(describePaymentHealth(null)).toBeNull();
    expect(describePaymentHealth({})).toBeNull();
  });
});
