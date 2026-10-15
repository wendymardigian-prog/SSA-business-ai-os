import { describe, expect, it } from "vitest";
import { buildPreviewRequest, paymentOptionLabel, saleOptionDetail, saleOptionLabel } from "./rules-ui-tester";

const SALE = "55555555-5555-4555-8555-555555555551";

describe("buildPreviewRequest", () => {
  it("un pago existente", () => {
    expect(buildPreviewRequest(SALE, { kind: "payment", paymentId: "p1" })).toEqual({ ok: true, input: { paymentId: "p1" } });
  });
  it("un cobro hipotético: dólares a céntimos y el método", () => {
    expect(buildPreviewRequest(SALE, { kind: "hypothetical", amountText: "99,50", method: "whop" })).toEqual({ ok: true, input: { saleId: SALE, amountCents: 9950, method: "whop" } });
    expect(buildPreviewRequest(SALE, { kind: "hypothetical", amountText: "250", method: "" })).toEqual({ ok: true, input: { saleId: SALE, amountCents: 25000, method: null } });
  });
  it("manda la regla sin guardar en draftRules", () => {
    const draft = { id: "regla-nueva" };
    expect(buildPreviewRequest(SALE, { kind: "payment", paymentId: "p1" }, draft)).toEqual({ ok: true, input: { paymentId: "p1", draftRules: [draft] } });
  });
  it("faltan datos o el monto no sirve", () => {
    expect(buildPreviewRequest(null, { kind: "payment", paymentId: "p1" })).toEqual({ ok: false, error: "Elegí una venta" });
    expect(buildPreviewRequest(SALE, null)).toMatchObject({ ok: false });
    expect(buildPreviewRequest(SALE, { kind: "hypothetical", amountText: "", method: "" })).toMatchObject({ ok: false });
    expect(buildPreviewRequest(SALE, { kind: "hypothetical", amountText: "mucho", method: "" })).toMatchObject({ ok: false });
    expect(buildPreviewRequest(SALE, { kind: "hypothetical", amountText: "0", method: "" })).toEqual({ ok: false, error: "El monto tiene que ser mayor que 0" });
    expect(buildPreviewRequest(SALE, { kind: "hypothetical", amountText: "999999999999", method: "" })).toEqual({ ok: false, error: "Ese monto es demasiado grande" });
  });
});

describe("etiquetas", () => {
  it("la venta", () => {
    const sale = { id: SALE, contactName: "Pedro", productText: "Mentoría", finalCents: 50000, status: "paid", saleDate: "2026-10-10" };
    expect(saleOptionLabel(sale)).toBe("Pedro · Mentoría");
    expect(saleOptionDetail(sale)).toBe("USD 500,00 · Pagada · 10/10");
  });
  it("el pago", () => {
    expect(paymentOptionLabel({ id: "p", type: "installment", status: "paid", amountCents: 25000, paidOn: "2026-10-10", dueDate: "2026-10-10", method: "whop" }, { whop: "Whop" })).toBe("Cuota · USD 250,00 · cobrado el 10/10 · Whop");
    expect(paymentOptionLabel({ id: "p", type: "reservation", status: "scheduled", amountCents: 10000, paidOn: null, dueDate: "2026-11-02", method: null })).toBe("Reserva · USD 100,00 · vence el 2/11");
  });
});
