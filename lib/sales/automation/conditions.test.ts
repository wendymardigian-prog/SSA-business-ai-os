import { describe, expect, it } from "vitest";
import { hasActiveSale, hasOverduePayments, lastSaleStatus, latePaymentsCount, saleAttributionType, saleFromBooking, saleUtm, totalPurchased, type ConditionPayment, type ConditionSale } from "./conditions";

const sale = (over: Partial<ConditionSale> = {}): ConditionSale => ({
  id: "s1", status: "paid", sale_date: "2026-10-01", created_at: "2026-10-01T10:00:00Z", product_snapshot: { product_id: "A", variant_id: "vA" },
  attribution: { source: "instagram", medium: "paid_social", campaign: "octubre" }, attribution_type: "last_touch", booking_id: null, ...over,
});
const pay = (over: Partial<ConditionPayment> = {}): ConditionPayment => ({ type: "installment", status: "paid", amount: 100, delay_days: 0, sale_id: "s1", ...over });

describe("venta activa", () => {
  it("cuenta las que no están canceladas, reembolsadas ni dadas de baja; acota por producto o variante", () => {
    expect(hasActiveSale([sale()], "")).toBe("true");
    expect(hasActiveSale([sale({ status: "cancelled" }), sale({ status: "refunded" }), sale({ status: "subscription_cancelled" })], "")).toBe("false");
    expect(hasActiveSale([sale()], "A")).toBe("true");
    expect(hasActiveSale([sale()], "vA")).toBe("true");
    expect(hasActiveSale([sale()], "B")).toBe("false");
    expect(hasActiveSale([], "")).toBe("false");
  });
});

describe("estado de la última venta", () => {
  it("la más reciente por fecha de venta, y a igualdad, por creación; sin ventas, vacío", () => {
    expect(lastSaleStatus([sale({ status: "paid" }), sale({ id: "s2", status: "overdue", sale_date: "2026-10-05" })])).toBe("overdue");
    expect(lastSaleStatus([sale({ status: "paid" }), sale({ id: "s2", status: "reserved", created_at: "2026-10-01T11:00:00Z" })])).toBe("reserved");
    expect(lastSaleStatus([])).toBe("");
  });
});

describe("pagos", () => {
  it("morosos y atraso mayor a N días", () => {
    expect(hasOverduePayments([pay(), pay({ status: "overdue" })])).toBe("true");
    expect(hasOverduePayments([pay()])).toBe("false");
    const payments = [pay({ delay_days: 8 }), pay({ delay_days: 3 }), pay({ delay_days: 0 }), pay({ status: "scheduled", delay_days: null }), pay({ type: "refund", delay_days: 20, amount: -5 })];
    expect(latePaymentsCount(payments, "7")).toBe("1");
    expect(latePaymentsCount(payments, "2")).toBe("2");
    expect(latePaymentsCount(payments, "")).toBe("2");
  });
  it("el monto total comprado es lo cobrado neto: los reembolsos restan", () => {
    expect(totalPurchased([pay({ amount: 1000 }), pay({ amount: 297.5 }), pay({ type: "refund", amount: -100 }), pay({ status: "scheduled", amount: 500 })])).toBe("1197.5");
    expect(totalPurchased([])).toBe("0");
  });
});

describe("atribución y agenda de la venta", () => {
  it("UTM source, medium y campaign; sin atribución, vacío", () => {
    expect(saleUtm(sale(), "source")).toBe("instagram");
    expect(saleUtm(sale(), "campaign")).toBe("octubre");
    expect(saleUtm(sale(), "content")).toBe("");
    expect(saleUtm(sale({ attribution: null, attribution_type: "none" }), "source")).toBe("");
    expect(saleUtm(null, "source")).toBe("");
  });
  it("tipo de atribución y si vino de una agenda", () => {
    expect(saleAttributionType(sale({ attribution_type: "manual" }))).toBe("manual");
    expect(saleFromBooking(sale({ booking_id: "b1" }))).toBe("true");
    expect(saleFromBooking(sale())).toBe("false");
    expect(saleFromBooking(null)).toBe("false");
  });
});
