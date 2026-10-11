import { describe, expect, it } from "vitest";
import { hasEditConflict, isLockedForEdit, lockedEditError, planRepricing } from "./edit";

const sale = {
  base_amount: 1000, discount_amount: 0, final_amount: 1000, discount_reason: null,
  product_snapshot: { price: 1000 }, product_version_id: "v1", financing_type: "installments",
};
const plan = [
  { type: "installment", status: "paid", amount: 400 },
  { type: "installment", status: "scheduled", amount: 600 },
];
const ctx = { maxPercent: null, hasAllScope: true, confirmRepricing: false, repricingReason: null };

describe("editar una venta", () => {
  it("cancelada, reembolsada o en disputa solo admiten notas", () => {
    for (const s of ["cancelled", "refunded", "disputed"]) {
      expect(isLockedForEdit(s)).toBe(true);
      expect(lockedEditError(s, ["pricing"])).toMatch(/no se edita/);
      expect(lockedEditError(s, [])).toBeNull();
    }
    expect(lockedEditError("paid", ["pricing"])).toBeNull();
  });

  it("cambiar el precio con cobros pide confirmación y motivo", () => {
    const change = { discount: { type: "amount" as const, value: 100 } };
    expect(planRepricing(sale, plan, change, ctx)).toMatchObject({ ok: false, code: "confirm_required", paidCents: 400 });
    expect(planRepricing(sale, plan, change, { ...ctx, confirmRepricing: true })).toMatchObject({ ok: false, code: "reason_required" });
    const ok = planRepricing(sale, plan, change, { ...ctx, confirmRepricing: true, repricingReason: "Acuerdo con el cliente" });
    expect(ok).toMatchObject({ ok: true, changed: true, planUnbalanced: true, diffCents: -10000 });
    if (ok.ok) expect(ok.patch.final_amount).toBe(900);
  });

  it("sin cobros no pide confirmación; sin cambio de monto no marca descuadre", () => {
    const scheduled = [{ type: "installment", status: "scheduled", amount: 1000 }];
    const r = planRepricing(sale, scheduled, { discount: { type: "amount", value: 100 } }, ctx);
    expect(r).toMatchObject({ ok: true, changed: true });
    const same = planRepricing(sale, scheduled, { discount: { type: "amount", value: 0 } }, ctx);
    expect(same).toMatchObject({ ok: true, changed: false, planUnbalanced: false });
  });

  it("el tope de descuento se respeta", () => {
    const r = planRepricing(sale, [], { discount: { type: "percent", value: 50 }, discountReason: "x" }, { ...ctx, maxPercent: 10, hasAllScope: false });
    expect(r).toMatchObject({ ok: false, code: "discount" });
  });

  it("conflicto de edición: solo si el updated_at cambió", () => {
    expect(hasEditConflict("2026-10-01T10:00:00Z", "2026-10-01T10:00:00.000Z")).toBe(false);
    expect(hasEditConflict("2026-10-01T10:00:00Z", "2026-10-01T10:05:00Z")).toBe(true);
    expect(hasEditConflict(null, "2026-10-01T10:05:00Z")).toBe(false);
  });
});
