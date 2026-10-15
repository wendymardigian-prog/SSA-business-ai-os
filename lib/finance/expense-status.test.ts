import { describe, expect, it } from "vitest";
import { EXPENSE_STATUSES, EXPENSE_STATUS_KEYS, allowedTransitions, expenseOriginLabel, expenseStatusLabel, isAutoOrigin, unpaidStatusFor } from "./expense-status";

describe("unpaidStatusFor", () => {
  it("hoy es programado; ayer, vencido", () => {
    expect(unpaidStatusFor("2026-10-10", "2026-10-10")).toBe("programado");
    expect(unpaidStatusFor("2026-10-10", "2026-10-11")).toBe("vencido");
    expect(unpaidStatusFor("2026-10-12", "2026-10-11")).toBe("programado");
  });
});

describe("allowedTransitions", () => {
  it("por revisar: confirmar monto, pagar, anular", () => {
    expect(allowedTransitions({ status: "por_revisar" })).toEqual(["confirm_amount", "pay", "void"]);
    expect(allowedTransitions({ status: "por_revisar" })).not.toContain("edit_date");
  });
  it("programado y vencido", () => {
    expect(allowedTransitions({ status: "programado" })).toEqual(["edit_date", "pay", "void"]);
    expect(allowedTransitions({ status: "vencido" })).toEqual(["reschedule", "pay", "void"]);
  });
  it("un pagado solo se revierte (no se anula directo) y un anulado no tiene nada", () => {
    expect(allowedTransitions({ status: "pagado" })).toEqual(["revert"]);
    expect(allowedTransitions({ status: "pagado" })).not.toContain("void");
    expect(allowedTransitions({ status: "anulado" })).toEqual([]);
  });
});

describe("etiquetas", () => {
  it("los cinco estados tienen etiqueta y color", () => {
    for (const k of EXPENSE_STATUS_KEYS) expect(EXPENSE_STATUSES[k].label.length).toBeGreaterThan(0);
    expect(expenseStatusLabel("por_revisar")).toBe("Por revisar");
    expect(expenseStatusLabel("raro")).toBe("raro");
  });
  it("orígenes", () => {
    expect(expenseOriginLabel("commission_payout")).toBe("Liquidación de comisiones");
    expect(isAutoOrigin("processor_fee")).toBe(true);
    expect(isAutoOrigin("meta_ads")).toBe(true);
    expect(isAutoOrigin("manual")).toBe(false);
  });
});
