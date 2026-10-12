import { describe, expect, it } from "vitest";
import { buildPaymentPlan } from "../payment-plan";
import { buildSummary } from "./summary";

const plan = (over: Record<string, unknown>) =>
  buildPaymentPlan({ total: 1297, financing: "reservation_installments", first: { amount: 297, paid: true, date: "2026-10-10", method: "wise" }, installments: 4, frequency: "monthly", firstDue: "2026-11-10", ...over } as never);

describe("buildSummary", () => {
  it("el primer pago cobrado cubre el total → Pagada", () => {
    const payments = buildPaymentPlan({ total: 500, financing: "full", first: { amount: 0, paid: true, date: "2026-10-10", method: "wise" }, frequency: "monthly", firstDue: "2026-10-10" });
    expect(buildSummary({ financing: "full", finalAmount: 500, payments, todayLocal: "2026-10-11" })).toMatchObject({ status: "paid", statusLabel: "Pagada", paymentsCount: 1, nextDue: null });
  });

  it("reserva cobrada y saldo → Reservada, con el próximo vencimiento", () => {
    const payments = plan({});
    const s = buildSummary({ financing: "reservation_installments", finalAmount: 1297, payments, todayLocal: "2026-10-11" });
    expect(s).toMatchObject({ status: "reserved", statusLabel: "Reservada", paymentsCount: 5, first: { amount: 297, status: "paid" }, nextDue: "2026-11-10", balanced: true, canSave: true });
  });

  it("cuota cobrada primero (no reserva) → Con pago pendiente", () => {
    const payments = buildPaymentPlan({ total: 1250, financing: "installments", first: { amount: 250, paid: true, date: "2026-10-10", method: "wise" }, installments: 4, frequency: "monthly", firstDue: "2026-11-10" });
    expect(buildSummary({ financing: "installments", finalAmount: 1250, payments, todayLocal: "2026-10-11" }).statusLabel).toBe("Con pago pendiente");
  });

  it("si no cuadra, «Guardar» no se habilita y la línea dice la diferencia exacta", () => {
    const payments = plan({}).slice(0, 4);
    const s = buildSummary({ financing: "reservation_installments", finalAmount: 1297, payments, todayLocal: "2026-10-11" });
    expect(s.canSave).toBe(false);
    expect(s.balanceLine).toBe("Falta asignar $250,00");
  });

  it("una suscripción se guarda sin cuadre", () => {
    const payments = buildPaymentPlan({ total: 99, financing: "subscription", first: { amount: 99, paid: false, date: "2026-10-20" }, frequency: "monthly", firstDue: "2026-10-20" });
    expect(buildSummary({ financing: "subscription", finalAmount: 500, payments, todayLocal: "2026-10-11" })).toMatchObject({ canSave: true, status: "subscription_active" });
  });

  it("lista los flujos que se van a disparar (vacío hasta que existan los triggers)", () => {
    const payments = plan({});
    expect(buildSummary({ financing: "reservation_installments", finalAmount: 1297, payments, todayLocal: "2026-10-11" }).flows).toEqual([]);
    expect(buildSummary({ financing: "reservation_installments", finalAmount: 1297, payments, todayLocal: "2026-10-11", matchingFlows: ["Pago cobrado → recibo"] }).flows).toEqual(["Pago cobrado → recibo"]);
  });

  it("el estado del resumen es el que calcula create_sale (misma función)", () => {
    const payments = plan({ first: { amount: 297, paid: false, date: "2026-10-12" } });
    expect(buildSummary({ financing: "reservation_installments", finalAmount: 1297, payments, todayLocal: "2026-10-11" }).status).toBe("pending_payment");
  });
});
