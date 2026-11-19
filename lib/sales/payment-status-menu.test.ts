import { describe, expect, it } from "vitest";
import { paymentStatusMenu } from "./payment-status-menu";

const actions = (status: string, isRefund = false, canManage = true) => paymentStatusMenu({ status, isRefund }, canManage).map((o) => o.action);

describe("paymentStatusMenu", () => {
  it("programado: solo cobrar", () => expect(actions("scheduled")).toEqual(["paid"]));
  it("moroso: cobrar o incobrable", () => expect(actions("overdue")).toEqual(["paid", "uncollectible"]));
  it("cobrado: revertir", () => expect(actions("paid")).toEqual(["revert"]));
  it("incobrable: volver a poner en cobro", () => {
    expect(actions("uncollectible")).toEqual(["revert"]);
    expect(paymentStatusMenu({ status: "uncollectible", isRefund: false }, true)[0].label).toBe("Volver a poner en cobro…");
  });
  it("reembolsado y cancelado no tienen menú", () => {
    expect(actions("refunded")).toEqual([]);
    expect(actions("cancelled")).toEqual([]);
  });
  it("un reembolso nunca tiene menú", () => {
    for (const s of ["scheduled", "overdue", "paid", "uncollectible"]) expect(actions(s, true)).toEqual([]);
  });
  it("sin permiso, nada", () => {
    for (const s of ["scheduled", "overdue", "paid", "uncollectible"]) expect(actions(s, false, false)).toEqual([]);
  });
});
