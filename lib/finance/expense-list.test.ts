import { describe, expect, it } from "vitest";
import { dueHint, groupExpenses, sortExpenses, totalsByStatus, type ExpenseListRow } from "./expense-list";

const row = (over: Partial<ExpenseListRow>): ExpenseListRow => ({ id: "a", concept: "x", vendor_id: null, category_key: "marketing", amount: 10, status: "programado", scheduled_date: "2026-10-10", paid_date: null, origin: "manual", receipt_path: null, ...over });

describe("totalsByStatus", () => {
  it("suma en céntimos exactos y deja los anulados fuera del total general", () => {
    const t = totalsByStatus([row({ amount: 0.1 }), row({ amount: 0.2 }), row({ amount: 416.67, status: "pagado" }), row({ amount: 416.67, status: "pagado" }), row({ amount: 416.66, status: "pagado" }), row({ amount: 50, status: "anulado" })]);
    expect(t.byStatus.programado).toEqual({ count: 2, cents: 30 });
    expect(t.byStatus.pagado).toEqual({ count: 3, cents: 125000 });
    expect(t.byStatus.anulado).toEqual({ count: 1, cents: 5000 });
    expect(t.total).toEqual({ count: 5, cents: 125030 });
  });
  it("un ajuste negativo resta", () => {
    expect(totalsByStatus([row({ amount: 50, status: "pagado" }), row({ amount: -4.2, status: "pagado", origin: "adjustment" })]).byStatus.pagado.cents).toBe(4580);
  });
});

describe("sortExpenses", () => {
  it("vencidos primero y después por fecha", () => {
    const sorted = sortExpenses([
      row({ id: "1", status: "programado", scheduled_date: "2026-10-12" }),
      row({ id: "2", status: "vencido", scheduled_date: "2026-10-20" }),
      row({ id: "3", status: "programado", scheduled_date: "2026-10-11" }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["2", "3", "1"]);
  });
});

describe("groupExpenses", () => {
  it("agrupa con subtotal sin anulados", () => {
    const groups = groupExpenses([row({ id: "1", amount: 10 }), row({ id: "2", amount: 5 }), row({ id: "3", amount: 7, category_key: "software" }), row({ id: "4", amount: 100, status: "anulado" })], "categoria", (k) => k.toUpperCase());
    expect(groups.map((g) => [g.label, g.cents])).toEqual([["MARKETING", 1500], ["SOFTWARE", 700]]);
  });
  it("un gasto sin proveedor va a su grupo propio", () => {
    expect(groupExpenses([row({})], "proveedor", (k) => k)[0].key).toBe("__sin_proveedor__");
  });
});

describe("dueHint", () => {
  it("dice cuánto falta o cuánto pasó", () => {
    expect(dueHint("2026-10-13", "2026-10-10", "programado")).toBe("vence en 3 días");
    expect(dueHint("2026-10-05", "2026-10-10", "vencido")).toBe("venció hace 5 días");
    expect(dueHint("2026-10-10", "2026-10-10", "programado")).toBe("vence hoy");
    expect(dueHint("2026-10-05", "2026-10-10", "pagado")).toBeNull();
  });
});
