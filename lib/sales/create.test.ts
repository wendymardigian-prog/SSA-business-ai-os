import { describe, expect, it } from "vitest";
import { applySaleRules, buildPaymentRows, createSaleInputSchema, mapCreateSaleError, type SaleRuleContext } from "./create";

const U = "00000000-0000-4000-8000-0000000000";
const CONTACT = `${U}01`;
const VARIANT = `${U}02`;
const ME = `${U}03`;

const snapshot = { product_id: "p", product_name: "Mentoría", product_type: "mentoria", variant_id: VARIANT, variant_name: "Estándar", price: 1297, currency: "USD" as const, duration_type: "lifetime", duration_value: null, billing_type: "one_time", billing_interval: null, event_date: null };

const ctx = (over: Partial<SaleRuleContext> = {}): SaleRuleContext => ({
  timeZone: "America/Costa_Rica", now: new Date("2026-10-11T18:00:00Z"), enabledMethods: ["wise", "binance", "whop"],
  maxDiscountPercent: null, hasAllScope: true, userId: ME, variant: { id: VARIANT, price: 1297 }, snapshot, ...over,
});

const input = (over: Record<string, unknown> = {}) =>
  createSaleInputSchema.parse({
    contactId: CONTACT, variantId: VARIANT, shownPrice: 1297, financing: "reservation_installments", saleDate: "2026-10-10", setterId: ME,
    payments: [
      { type: "reservation", amount: 297, status: "paid", date: "2026-10-10", method: "wise" },
      { type: "installment", amount: 500, status: "scheduled", date: "2026-11-10" },
      { type: "installment", amount: 500, status: "scheduled", date: "2026-12-10" },
    ],
    ...over,
  });

describe("applySaleRules", () => {
  it("una venta válida arma el payload de create_sale: snapshot, montos y pagos", () => {
    const r = applySaleRules(input(), ctx());
    expect(r).toMatchObject({ ok: true, finalAmount: 1297 });
    if (!r.ok) return;
    expect(r.payload).toMatchObject({ contact_id: CONTACT, product_variant_id: VARIANT, base_amount: 1297, discount_amount: 0, financing_type: "reservation_installments", attribution: { mode: "last_touch" } });
    expect((r.payload.payments as unknown[]).length).toBe(3);
  });

  it("el cuadre se valida en el servidor, con la diferencia exacta en céntimos", () => {
    const r = applySaleRules(input({ payments: [{ type: "full", amount: 1296.99, status: "scheduled", date: "2026-11-01" }], financing: "full" }), ctx());
    expect(r).toMatchObject({ ok: false, code: "plan_unbalanced", diffCents: 1 });
  });

  it("una suscripción no se cuadra, pero pide el intervalo", () => {
    expect(applySaleRules(input({ financing: "subscription", payments: [{ type: "full", amount: 99, status: "scheduled", date: "2026-11-01" }] }), ctx())).toMatchObject({ ok: false, code: "invalid" });
    expect(applySaleRules(input({ financing: "subscription", subscriptionInterval: "monthly", payments: [{ type: "full", amount: 99, status: "scheduled", date: "2026-11-01" }] }), ctx())).toMatchObject({ ok: true });
  });

  it("el descuento: aplica y recalcula el cuadre sobre el final", () => {
    const r = applySaleRules(
      input({ discount: { type: "amount", value: 200 }, payments: [{ type: "full", amount: 1097, status: "scheduled", date: "2026-11-01" }], financing: "full" }),
      ctx(),
    );
    expect(r).toMatchObject({ ok: true, finalAmount: 1097 });
  });

  it("un descuento sobre el tope sin alcance 'all' se rechaza aunque el cliente lo mande", () => {
    const own = ctx({ hasAllScope: false, maxDiscountPercent: 10 });
    const r = applySaleRules(input({ discount: { type: "percent", value: 30 }, discountReason: "Porque sí", payments: [{ type: "full", amount: 907.9, status: "scheduled", date: "2026-11-01" }], financing: "full" }), own);
    expect(r).toMatchObject({ ok: false, code: "discount" });
  });

  it("con alcance own, quien carga tiene que quedar como setter o vendedor", () => {
    const own = ctx({ hasAllScope: false });
    expect(applySaleRules(input({ setterId: null, vendedorId: null }), own)).toMatchObject({ ok: false, code: "scope" });
    expect(applySaleRules(input({ setterId: null, vendedorId: ME }), own)).toMatchObject({ ok: true });
  });

  it("la fecha de la venta no puede ser futura (en la zona del workspace)", () => {
    // 01:00 UTC del 12/10 sigue siendo el 11/10 en Costa Rica: el 12 es futuro.
    const early = ctx({ now: new Date("2026-10-12T01:00:00Z") });
    const sched = [{ type: "full", amount: 1297, status: "scheduled", date: "2026-11-01" }];
    expect(applySaleRules(input({ saleDate: "2026-10-12", financing: "full", payments: sched }), early)).toMatchObject({ ok: false, code: "date" });
    expect(applySaleRules(input({ saleDate: "2026-10-11", financing: "full", payments: sched }), early)).toMatchObject({ ok: true });
  });

  it("un pago cobrado antes de la fecha de la venta se rechaza", () => {
    const r = applySaleRules(input({ saleDate: "2026-10-10", payments: [{ type: "full", amount: 1297, status: "paid", date: "2026-10-09", method: "wise" }], financing: "full" }), ctx());
    expect(r).toMatchObject({ ok: false, code: "date" });
  });

  it("un cobro sin método, con un método inventado o deshabilitado se rechaza; un programado no lo exige", () => {
    const pay = (method: string | null) => input({ financing: "full", payments: [{ type: "full", amount: 1297, status: "paid", date: "2026-10-10", method }] });
    expect(applySaleRules(pay(null), ctx())).toMatchObject({ ok: false, code: "method" });
    expect(applySaleRules(pay("paypal"), ctx())).toMatchObject({ ok: false, code: "method" });
    expect(applySaleRules(pay("wise"), ctx({ enabledMethods: ["binance"] }))).toMatchObject({ ok: false, code: "method" });
    expect(applySaleRules(pay("wise"), ctx())).toMatchObject({ ok: true });
  });

  it("la atribución viaja como el servidor la espera (touch / manual / last_touch)", () => {
    const touch = applySaleRules(input({ attribution: { mode: "touch", touchId: `${U}09` } }), ctx());
    expect(touch.ok && touch.payload.attribution).toEqual({ mode: "touch", touch_id: `${U}09` });
    const manual = applySaleRules(input({ attribution: { mode: "manual", manual: { source: "instagram", medium: "paid_social", campaign: " octubre " } } }), ctx());
    expect(manual.ok && manual.payload.attribution).toEqual({ mode: "manual", manual: { source: "instagram", medium: "paid_social", campaign: "octubre" } });
  });
});

describe("atribución cargada a mano por canal (manual_channel)", () => {
  const PIECE = `${U}20`;

  it("el esquema acepta la elección, normaliza sus textos y conserva la clave de idempotencia", () => {
    const parsed = input({ idempotencyKey: " wizard-key-0001 ", attribution: { mode: "manual_channel", choice: { kind: "event", name: "  Expo 2026 " }, label: "Evento" } });
    expect(parsed.idempotencyKey).toBe("wizard-key-0001");
    expect(parsed.attribution).toMatchObject({ mode: "manual_channel", choice: { kind: "event", name: "Expo 2026" } });
  });

  it("una elección con forma inválida no pasa el esquema", () => {
    expect(() => input({ attribution: { mode: "manual_channel", choice: { kind: "organic", network: "snapchat" } } })).toThrow();
    expect(() => input({ attribution: { mode: "manual_channel", choice: { kind: "organic", network: "instagram", piece: { contentPostId: "no-uuid" } } } })).toThrow();
    expect(() => input({ idempotencyKey: "corta" })).toThrow();
  });

  it("applySaleRules no arma el payload: la acción tiene que resolver el toque antes", () => {
    const r = applySaleRules(input({ attribution: { mode: "manual_channel", choice: { kind: "organic", network: "instagram", piece: { contentPostId: PIECE } } } }), ctx());
    expect(r).toMatchObject({ ok: false, code: "invalid_manual" });
  });
});

describe("buildPaymentRows", () => {
  it("lo cobrado vence el día del cobro, con fecha local, instante, snapshot y comisión congelada", () => {
    const [row] = buildPaymentRows([{ type: "full", amount: 416.67, status: "paid", date: "2026-10-10", method: "wise", notes: null }], { timeZone: "America/Costa_Rica", now: new Date("2026-10-11T18:00:00Z") });
    expect(row).toMatchObject({ status: "paid", due_date: "2026-10-10", paid_on: "2026-10-10", payment_method: "wise", provider_fee_amount: 0, payment_option_snapshot: { method_key: "wise", method_name: "Wise" } });
    // Mediodía de Costa Rica (UTC-6) = 18:00 UTC.
    expect(row.paid_at).toBe("2026-10-10T18:00:00.000Z");
  });

  it("si se cobra hoy, el instante es ahora", () => {
    const now = new Date("2026-10-11T18:30:00Z");
    const [row] = buildPaymentRows([{ type: "full", amount: 10, status: "paid", date: "2026-10-11", method: "binance", notes: null }], { timeZone: "America/Costa_Rica", now });
    expect(row.paid_at).toBe(now.toISOString());
  });

  it("lo programado no lleva comisión ni fecha de cobro", () => {
    const [row] = buildPaymentRows([{ type: "installment", amount: 250, status: "scheduled", date: "2026-11-10", method: null, notes: null }], { timeZone: "UTC", now: new Date() });
    expect(row).toMatchObject({ status: "scheduled", due_date: "2026-11-10" });
    expect(row).not.toHaveProperty("paid_on");
    expect(row).not.toHaveProperty("provider_fee_amount");
  });
});

describe("mapCreateSaleError", () => {
  it("traduce los códigos de create_sale", () => {
    expect(mapCreateSaleError("price_changed:1400")).toMatchObject({ code: "price_changed", newPrice: 1400 });
    expect(mapCreateSaleError("invalid_variant")).toMatchObject({ code: "invalid" });
    expect(mapCreateSaleError("plan_unbalanced:-250")).toMatchObject({ code: "plan_unbalanced", diffCents: -250 });
    expect(mapCreateSaleError("invalid_touch")).toMatchObject({ code: "invalid_touch" });
    expect(mapCreateSaleError("invalid_booking")).toMatchObject({ code: "invalid_booking" });
    expect(mapCreateSaleError("invalid_sale_date")).toMatchObject({ code: "date" });
    expect(mapCreateSaleError("algo raro de la base")).toMatchObject({ code: "server" });
  });
});

describe("createSaleInputSchema", () => {
  it("rechaza un reembolso al crear, montos no positivos y fechas inválidas", () => {
    expect(createSaleInputSchema.safeParse({ ...input(), payments: [{ type: "refund", amount: 10, status: "paid", date: "2026-10-10" }] }).success).toBe(false);
    expect(createSaleInputSchema.safeParse({ ...input(), payments: [{ type: "full", amount: 0, status: "scheduled", date: "2026-10-10" }] }).success).toBe(false);
    expect(createSaleInputSchema.safeParse({ ...input(), saleDate: "ayer" }).success).toBe(false);
    expect(createSaleInputSchema.safeParse({ ...input(), payments: [] }).success).toBe(false);
  });
});
