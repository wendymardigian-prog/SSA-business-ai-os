import { describe, expect, it } from "vitest";
import { refundNotes, refundRowsFromSuggestions, suggestionText, validateManualAdjustment, validateRefundAdjustments, type ManualAdjustmentForm } from "./adjustment-form";

const USER = "33333333-3333-4333-8333-333333333333";
const SALE = "55555555-5555-4555-8555-555555555551";
const PAY = "66666666-6666-4666-8666-666666666661";

const form = (patch: Partial<ManualAdjustmentForm> = {}): ManualAdjustmentForm => ({ userId: USER, amountText: "-19,41", notes: "Reembolso parcial", saleId: null, paymentId: null, role: null, ...patch });

describe("validateManualAdjustment", () => {
  it("arma el ajuste en dólares, también negativo", () => {
    const r = validateManualAdjustment(form({ saleId: SALE, paymentId: PAY, role: "vendedor" }));
    expect(r).toEqual({ ok: true, value: { userId: USER, amount: -19.41, notes: "Reembolso parcial", saleId: SALE, paymentId: PAY, role: "vendedor" } });
    expect(validateManualAdjustment(form({ amountText: "1.240,50" }))).toMatchObject({ ok: true, value: { amount: 1240.5 } });
  });

  it("pide persona, monto y motivo, con un mensaje que dice qué falta", () => {
    expect(validateManualAdjustment(form({ userId: "" }))).toEqual({ ok: false, error: "Elegí a quién va el ajuste" });
    expect(validateManualAdjustment(form({ amountText: "" }))).toEqual({ ok: false, error: "Poné el monto (negativo si resta)" });
    expect(validateManualAdjustment(form({ amountText: "0" }))).toEqual({ ok: false, error: "El monto no puede ser 0" });
    expect(validateManualAdjustment(form({ amountText: "abc" })).ok).toBe(false);
    expect(validateManualAdjustment(form({ notes: "   " }))).toEqual({ ok: false, error: "Contá el motivo del ajuste" });
  });

  it("el motivo tiene tope de 500 y un pago necesita su venta", () => {
    expect(validateManualAdjustment(form({ notes: "x".repeat(501) }))).toEqual({ ok: false, error: "El motivo puede tener hasta 500 caracteres" });
    expect(validateManualAdjustment(form({ paymentId: PAY }))).toEqual({ ok: false, error: "Elegí primero la venta del pago" });
  });
});

describe("ajustes por un reembolso", () => {
  const suggestions = {
    suggestions: [
      { userId: USER, userName: "Ana", commissions: [{ id: "c1", role: "vendedor", amountCents: 3882 }], originalCents: 3882, suggestedCents: -1941, alreadyAdjustedCents: 0 },
      { userId: "44444444-4444-4444-8444-444444444444", userName: null, commissions: [{ id: "c2", role: "setter", amountCents: 2500 }, { id: "c3", role: "contenido", amountCents: 1500 }], originalCents: 4000, suggestedCents: -2000, alreadyAdjustedCents: -2000 },
      { userId: "55555555-5555-4555-8555-555555555552", userName: "Beto", commissions: [], originalCents: 0, suggestedCents: 0, alreadyAdjustedCents: 0 },
    ],
  };
  const rows = refundRowsFromSuggestions(suggestions);

  it("arma una línea por persona con la sugerencia como texto editable", () => {
    expect(rows.map((r) => [r.userName, r.role, r.amountText, r.included])).toEqual([
      ["Ana", "vendedor", "-19,41", true],
      ["Una persona que ya no está en el equipo", null, "-20,00", false], // ya se le ajustó algo: arranca sin tildar
      ["Beto", null, "", false], // nada que sugerir
    ]);
  });

  it("carga solo lo tildado, con la venta y el pago del reembolso", () => {
    const r = validateRefundAdjustments({ rows, notes: refundNotes(5000, 10000), saleId: SALE, refundPaymentId: PAY });
    expect(r).toEqual({
      ok: true,
      value: [{ userId: USER, amount: -19.41, notes: "Reembolso de USD 50,00 sobre USD 100,00 cobrados (50 %)", saleId: SALE, paymentId: PAY, role: "vendedor" }],
    });
  });

  it("deja cambiar la sugerencia, pero un reembolso nunca suma", () => {
    const edited = rows.map((r, i) => (i === 0 ? { ...r, amountText: "-10" } : r));
    expect(validateRefundAdjustments({ rows: edited, notes: "x", saleId: SALE, refundPaymentId: PAY })).toMatchObject({ ok: true, value: [{ amount: -10 }] });
    const positive = rows.map((r, i) => (i === 0 ? { ...r, amountText: "5" } : r));
    expect(validateRefundAdjustments({ rows: positive, notes: "x", saleId: SALE, refundPaymentId: PAY })).toEqual({ ok: false, error: "Ana: un reembolso resta, el monto tiene que ser negativo" });
  });

  it("sin nada tildado no hay nada para cargar", () => {
    expect(validateRefundAdjustments({ rows: rows.map((r) => ({ ...r, included: false })), notes: "x", saleId: SALE, refundPaymentId: PAY })).toEqual({
      ok: false,
      error: "Tildá al menos una persona para cargarle el ajuste",
    });
  });

  it("el motivo es obligatorio también acá", () => {
    expect(validateRefundAdjustments({ rows, notes: " ", saleId: SALE, refundPaymentId: PAY })).toEqual({ ok: false, error: "Ana: Contá el motivo del ajuste" });
  });
});

describe("textos", () => {
  it("suggestionText y refundNotes", () => {
    expect(suggestionText(-1941)).toBe("-19,41");
    expect(suggestionText(0)).toBe("");
    expect(refundNotes(2500, 10000)).toBe("Reembolso de USD 25,00 sobre USD 100,00 cobrados (25 %)");
    expect(refundNotes(100, 0)).toBe("Reembolso de USD 1,00 sobre USD 0,00 cobrados");
    expect(refundNotes(33333, 100000)).toBe("Reembolso de USD 333,33 sobre USD 1.000,00 cobrados (33,3 %)");
  });
});
