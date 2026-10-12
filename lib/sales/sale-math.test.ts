import { describe, expect, it } from "vitest";
import { buildProductSnapshot, checkDiscount, computeFinalAmount, discountCents, saleBalance, saleExpected, salePaid } from "./sale-math";

describe("computeFinalAmount", () => {
  it("un monto fijo resta exacto; un porcentaje se redondea al céntimo", () => {
    expect(computeFinalAmount(1497, { type: "amount", value: 200 })).toBe(1297);
    expect(computeFinalAmount(1497, { type: "percent", value: 15 })).toBe(1272.45);
    expect(computeFinalAmount(1497, null)).toBe(1497);
  });
  it("con importes que no cierran redondo", () => {
    expect(computeFinalAmount(1297.33, { type: "percent", value: 10 })).toBe(1167.6);
    expect(discountCents(1297.33, { type: "percent", value: 10 })).toBe(12973);
  });
});

describe("checkDiscount", () => {
  const all = { hasAllScope: true };
  const own = { hasAllScope: false };

  it("un descuento que deja el final negativo se rechaza", () => {
    expect(checkDiscount(1000, { type: "amount", value: 1000.01 }, all)).toMatchObject({ ok: false, code: "negative" });
    expect(checkDiscount(1000, { type: "amount", value: 1000 }, all)).toMatchObject({ ok: true, finalAmount: 0 });
  });

  it("sin tope todo descuento válido pasa", () => {
    expect(checkDiscount(1000, { type: "percent", value: 90 }, own)).toMatchObject({ ok: true });
  });

  it("sobre el tope sin motivo se rechaza; con motivo y alcance all pasa", () => {
    expect(checkDiscount(1000, { type: "percent", value: 30 }, { ...all, maxPercent: 25 })).toMatchObject({ ok: false, code: "reason_required" });
    expect(checkDiscount(1000, { type: "percent", value: 30 }, { ...all, maxPercent: 25, reason: "Cliente recurrente" })).toMatchObject({ ok: true, discountAmount: 300, finalAmount: 700 });
  });

  it("quien tiene alcance own no puede pasar el tope, aunque ponga un motivo", () => {
    expect(checkDiscount(1000, { type: "percent", value: 30 }, { ...own, maxPercent: 25, reason: "Porque sí" })).toMatchObject({ ok: false, code: "needs_scope" });
  });

  it("justo en el tope pasa (se compara en céntimos)", () => {
    expect(checkDiscount(1297.33, { type: "percent", value: 25 }, { ...own, maxPercent: 25 })).toMatchObject({ ok: true });
    expect(checkDiscount(1000, { type: "amount", value: 250.01 }, { ...own, maxPercent: 25 })).toMatchObject({ ok: false, code: "needs_scope" });
  });
});

describe("buildProductSnapshot", () => {
  it("incluye todos los campos del plano", () => {
    const snap = buildProductSnapshot(
      { id: "p1", name: "Mentoría", product_type: "mentoria" },
      { id: "v1", name: "Estándar", duration_type: "months", duration_value: 6, billing_type: "one_time", billing_interval: null, guarantee_duration_type: "days", guarantee_duration_value: 30, price: "1497.00" },
    );
    expect(Object.keys(snap).sort()).toEqual([
      "billing_interval", "billing_type", "currency", "duration_type", "duration_value", "guarantee_duration_type", "guarantee_duration_value",
      "price", "product_id", "product_name", "product_type", "variant_id", "variant_name",
    ]);
    expect(snap).toMatchObject({ price: 1497, currency: "USD", variant_id: "v1" });
  });
});

describe("saldo y por cobrar", () => {
  it("1.250 con cobros 416,67 + 416,67 + 416,66 → saldo exactamente 0", () => {
    const pagos = [416.67, 416.67, 416.66].map((amount) => ({ amount, status: "paid" }));
    expect(saleBalance(1250, pagos)).toBe(0);
  });

  it("1.250 con 1.000 cobrados y un incobrable de 250 → saldo 250, por cobrar 0", () => {
    const pagos = [{ amount: 1000, status: "paid" }, { amount: 250, status: "uncollectible" }];
    expect(saleBalance(1250, pagos)).toBe(250);
    expect(saleExpected(pagos)).toBe(0);
  });

  it("por cobrar suma programados y morosos; los anulados no entran; un reembolso resta del cobrado", () => {
    const pagos = [
      { amount: 500, status: "paid" },
      { amount: 250, status: "scheduled" },
      { amount: 150.5, status: "overdue" },
      { amount: 99, status: "cancelled" },
      { amount: -100, status: "paid" },
    ];
    expect(saleExpected(pagos)).toBe(400.5);
    expect(salePaid(pagos)).toBe(400);
  });
});
