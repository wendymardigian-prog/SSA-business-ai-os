import { describe, expect, it } from "vitest";
import { commissionAdjustmentSchema, refundSuggestion } from "./adjustment";

const ANA = "a0000000-0000-4000-8000-000000000001";
const SALE = "f0000000-0000-4000-8000-000000000001";
const ok = { userId: ANA, amount: -19.41, notes: "Reembolso de Pedro" };

describe("commissionAdjustmentSchema", () => {
  it("un ajuste negativo es válido y trae los céntimos", () => {
    const r = commissionAdjustmentSchema.safeParse(ok);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ userId: ANA, amount: -19.41, amountCents: -1941, notes: "Reembolso de Pedro", saleId: null, paymentId: null, role: null });
  });
  it("uno positivo, con venta, pago y rol", () => {
    const r = commissionAdjustmentSchema.safeParse({ ...ok, amount: 50, saleId: SALE, paymentId: SALE, role: "vendedor" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ amountCents: 5000, saleId: SALE, paymentId: SALE, role: "vendedor" });
  });
  it("monto 0 rechazado (también el que redondea a 0)", () => {
    expect(commissionAdjustmentSchema.safeParse({ ...ok, amount: 0 }).success).toBe(false);
    expect(commissionAdjustmentSchema.safeParse({ ...ok, amount: -0 }).success).toBe(false);
    expect(commissionAdjustmentSchema.safeParse({ ...ok, amount: 0.001 }).success).toBe(false);
  });
  it("monto con más de dos decimales, infinito o NaN rechazado", () => {
    expect(commissionAdjustmentSchema.safeParse({ ...ok, amount: 10.005 }).success).toBe(false);
    expect(commissionAdjustmentSchema.safeParse({ ...ok, amount: Number.NaN }).success).toBe(false);
    expect(commissionAdjustmentSchema.safeParse({ ...ok, amount: Infinity }).success).toBe(false);
  });
  it("sin motivo o motivo de solo espacios rechazado; hasta 500 caracteres", () => {
    expect(commissionAdjustmentSchema.safeParse({ ...ok, notes: "" }).success).toBe(false);
    expect(commissionAdjustmentSchema.safeParse({ ...ok, notes: "   " }).success).toBe(false);
    expect(commissionAdjustmentSchema.safeParse({ userId: ANA, amount: 5 }).success).toBe(false);
    expect(commissionAdjustmentSchema.safeParse({ ...ok, notes: "x".repeat(500) }).success).toBe(true);
    expect(commissionAdjustmentSchema.safeParse({ ...ok, notes: "x".repeat(501) }).success).toBe(false);
  });
  it("la persona es obligatoria y tiene que ser un uuid", () => {
    expect(commissionAdjustmentSchema.safeParse({ amount: 5, notes: "x" }).success).toBe(false);
    expect(commissionAdjustmentSchema.safeParse({ ...ok, userId: "ana" }).success).toBe(false);
    expect(commissionAdjustmentSchema.safeParse({ ...ok, userId: null }).success).toBe(false);
  });
  it("rechaza campos que no existen y ids o rol mal formados", () => {
    expect(commissionAdjustmentSchema.safeParse({ ...ok, workspaceId: SALE }).success).toBe(false);
    expect(commissionAdjustmentSchema.safeParse({ ...ok, saleId: "x" }).success).toBe(false);
    expect(commissionAdjustmentSchema.safeParse({ ...ok, role: "MAL ROL" }).success).toBe(false);
  });
});

describe("refundSuggestion", () => {
  it("un reembolso del 50 % de una comisión de 38,82 sugiere −19,41", () => {
    expect(refundSuggestion(3882, 25000, 50000)).toBe(-1941);
  });
  it("el ejemplo del plano: −19,41 / −12,50 / −7,50 para 38,82 / 25,00 / 15,00", () => {
    expect([3882, 2500, 1500].map((c) => refundSuggestion(c, 25000, 50000))).toEqual([-1941, -1250, -750]);
  });
  it("redondea al centavo (medio sube)", () => {
    // 3883 × 1/2 = 1941,5 → 1942
    expect(refundSuggestion(3883, 1, 2)).toBe(-1942);
    // 1000 × 1/3 = 333,33 → 333
    expect(refundSuggestion(1000, 1, 3)).toBe(-333);
    // 1000 × 2/3 = 666,67 → 667
    expect(refundSuggestion(1000, 2, 3)).toBe(-667);
  });
  it("un reembolso total devuelve toda la comisión", () => {
    expect(refundSuggestion(3882, 50000, 50000)).toBe(-3882);
  });
  it("un reembolso mayor al cobrado se topa en el 100 %", () => {
    expect(refundSuggestion(3882, 80000, 50000)).toBe(-3882);
  });
  it("acepta el reembolso con signo (la fila refund es negativa)", () => {
    expect(refundSuggestion(3882, -25000, 50000)).toBe(-1941);
  });
  it("sin cobro, sin reembolso o sin comisión no sugiere nada (y nunca devuelve -0)", () => {
    expect(refundSuggestion(3882, 25000, 0)).toBe(0);
    expect(Object.is(refundSuggestion(3882, 0, 50000), 0)).toBe(true);
    expect(Object.is(refundSuggestion(0, 25000, 50000), 0)).toBe(true);
    expect(Object.is(refundSuggestion(1, 1, 1000), 0)).toBe(true);
    expect(refundSuggestion(Number.NaN, 25000, 50000)).toBe(0);
  });
});
