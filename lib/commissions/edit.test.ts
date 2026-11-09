// @plantilla-quitar(comisiones)
import { describe, expect, it } from "vitest";
import { buildCommissionEdit, canEditCommission, parseAmount, type EditableCommission } from "./edit";

const base: EditableCommission = { expenseId: null, voidedAt: null, amount: 100, role: "seller", userId: "u1", contactId: null };
const form = { void: false, amount: "100", role: "seller", person: { type: "user" as const, id: "u1" }, reason: "corrección" };

describe("editar una comisión", () => {
  it("solo se edita pendiente y sin gasto", () => {
    expect(canEditCommission(base)).toBe(true);
    expect(canEditCommission({ ...base, expenseId: "e1" })).toBe(false);
    expect(canEditCommission({ ...base, voidedAt: "2026-11-01" })).toBe(false);
    expect(buildCommissionEdit({ ...base, expenseId: "e1" }, { ...form, amount: "90" }).ok).toBe(false);
  });

  it("lee montos con coma o punto, mayores a cero y hasta dos decimales", () => {
    expect(parseAmount("150,5")).toBe(150.5);
    expect(parseAmount(" 150.50 ")).toBe(150.5);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("-3")).toBeNull();
    expect(parseAmount("1.234")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });

  it("pide motivo y algún cambio", () => {
    expect(buildCommissionEdit(base, { ...form, amount: "90", reason: "  " })).toEqual({ ok: false, error: "Escribí el motivo" });
    expect(buildCommissionEdit(base, form)).toEqual({ ok: false, error: "No cambiaste nada" });
  });

  it("arma el parche con solo lo que cambió", () => {
    expect(buildCommissionEdit(base, { ...form, amount: "90" })).toEqual({ ok: true, patch: { void: false, amount: 90 }, reason: "corrección" });
    expect(buildCommissionEdit(base, { ...form, person: { type: "contact", id: "c9" } })).toEqual({
      ok: true,
      patch: { void: false, amount: 100, user_id: null, contact_id: "c9" },
      reason: "corrección",
    });
    expect(buildCommissionEdit(base, { ...form, role: "setter" })).toEqual({ ok: true, patch: { void: false, amount: 100, role: "setter" }, reason: "corrección" });
  });

  it("anular no necesita monto", () => {
    expect(buildCommissionEdit(base, { ...form, void: true, amount: "" })).toEqual({ ok: true, patch: { void: true }, reason: "corrección" });
  });
});
