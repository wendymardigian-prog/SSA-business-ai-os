import { describe, expect, it } from "vitest";
import { countActivePaymentFilters, monthRange, parsePaymentsFilters, paymentListRow, paymentsFiltersToParams, paymentsQueryFilters, paymentsTotals, weekRange } from "./payments-list";

describe("filtros ↔ URL", () => {
  it("ida y vuelta, descartando lo desconocido", () => {
    const f = parsePaymentsFilters({ pastilla: "morosos", estado: "paid,inventado", metodo: "wise", vence_desde: "2026-10-01", vence_hasta: "no", cobro_desde: "2026-10-02", vendedor: "u1", atraso: "7", q: "ana", pagina: "2" });
    expect(f).toMatchObject({ pill: "morosos", status: ["paid"], method: "wise", dueFrom: "2026-10-01", dueTo: null, paidFrom: "2026-10-02", vendedorId: "u1", delayOver: 7, q: "ana", page: 2 });
    expect(parsePaymentsFilters(Object.fromEntries(paymentsFiltersToParams(f).entries()))).toEqual(f);
    expect(paymentsFiltersToParams(parsePaymentsFilters({})).toString()).toBe("");
    expect(countActivePaymentFilters(f)).toBe(6);
  });
  it("«atraso 0» es un filtro válido; sin el parámetro no hay filtro", () => {
    expect(parsePaymentsFilters({ atraso: "0" }).delayOver).toBe(0);
    expect(parsePaymentsFilters({}).delayOver).toBeNull();
  });
});

describe("consulta", () => {
  const f = (over: Record<string, string>) => parsePaymentsFilters(over);
  it("«Vencen esta semana» = programados con vencimiento dentro de la semana local", () => {
    expect(weekRange("2026-10-11")).toEqual({ from: "2026-10-11", to: "2026-10-18" });
    expect(paymentsQueryFilters(f({ pastilla: "esta_semana" }), "2026-10-11")).toEqual([
      { column: "status", op: "eq", value: "scheduled" }, { column: "due_date", op: "gte", value: "2026-10-11" }, { column: "due_date", op: "lte", value: "2026-10-18" },
    ]);
  });
  it("«Cobrados este mes» usa el mes local y deja afuera los reembolsos", () => {
    expect(monthRange("2026-02-11")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    const q = paymentsQueryFilters(f({ pastilla: "cobrados_mes" }), "2026-10-11");
    expect(q).toContainEqual({ column: "type", op: "neq", value: "refund" });
    expect(q).toContainEqual({ column: "paid_on", op: "gte", value: "2026-10-01" });
    expect(q).toContainEqual({ column: "paid_on", op: "lte", value: "2026-10-31" });
  });
  it("«atraso mayor a 7 días» usa delay_days > 7", () => {
    expect(paymentsQueryFilters(f({ atraso: "7" }), "2026-10-11")).toContainEqual({ column: "delay_days", op: "gt", value: 7 });
  });
  it("sin pastilla, el estado y el método filtran por columna", () => {
    const q = paymentsQueryFilters(f({ estado: "paid,overdue", metodo: "wise" }), "2026-10-11");
    expect(q).toContainEqual({ column: "status", op: "in", value: ["paid", "overdue"] });
    expect(q).toContainEqual({ column: "payment_method", op: "eq", value: "wise" });
  });
});

describe("filas y totales", () => {
  const row = (over: Record<string, unknown>) => ({ id: "p", sale_id: "s", type: "installment", status: "paid", amount: 0, due_date: "2026-10-01", paid_on: "2026-10-02", delay_days: 1, payment_method: "wise", provider_fee_amount: 0, ...over });
  it("bruto, comisión y neto de lo cobrado, en céntimos, coinciden con la suma de las filas", () => {
    const rows = [row({ amount: 100.1, provider_fee_amount: 2.9 }), row({ amount: 200.2, provider_fee_amount: 5.8 }), row({ status: "scheduled", amount: 50 }), row({ type: "refund", amount: -20, provider_fee_amount: null })];
    const t = paymentsTotals(rows);
    expect(t.count).toBe(4);
    expect(t.amount).toBe(330.3);
    expect(t.paid).toEqual({ count: 3, gross: 280.3, fee: 8.7, net: 271.6 });
  });
  it("las acciones en línea solo con permiso y sobre pagos abiertos", () => {
    expect(paymentListRow(row({ status: "scheduled" }) as never, true).canAct).toEqual({ markPaid: true, reschedule: true });
    expect(paymentListRow(row({ status: "scheduled" }) as never, false).canAct).toEqual({ markPaid: false, reschedule: false });
    expect(paymentListRow(row({ status: "paid" }) as never, true).canAct).toEqual({ markPaid: false, reschedule: false });
  });
});
