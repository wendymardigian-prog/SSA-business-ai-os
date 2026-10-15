import { describe, expect, it } from "vitest";
import { classifyRows, type ExpenseRef, type LightCommission } from "./list-model";
import { mineSummary, mineSummaryText } from "./mine";

const TODAY = "2026-10-15";
let n = 0;
const row = (patch: Partial<LightCommission> = {}): LightCommission => {
  n += 1;
  return {
    id: `c${n}`, kind: "earned", role: "vendedor", user_id: "u1", payment_id: "p", sale_id: "s1", rule_id: "r", amount: 10, base_amount: 100,
    paid_on: "2026-10-10", available_on: "2026-10-10", expense_id: null, voided_at: null, created_at: "2026-10-10T10:00:00Z", ...patch,
  };
};
const expenses = new Map<string, ExpenseRef>([
  ["e-oct", { expense_id: "e-oct", status: "pagado", scheduled_date: "2026-10-01", paid_date: "2026-10-12" }],
  ["e-sep", { expense_id: "e-sep", status: "pagado", scheduled_date: "2026-09-01", paid_date: "2026-09-28" }],
  ["e-prog", { expense_id: "e-prog", status: "programado", scheduled_date: "2026-10-20", paid_date: null }],
]);
const classify = (rows: LightCommission[]) => classifyRows(rows, expenses, new Map(), TODAY);

describe("mineSummary", () => {
  it("suma como generadas las vivas con cobro de este mes, y como pagadas las de un gasto pagado este mes", () => {
    const rows = classify([
      row({ amount: 300 }), // cobrada en octubre, pendiente
      row({ amount: 520, expense_id: "e-oct" }), // cobrada en octubre y pagada en octubre
      row({ amount: 40, paid_on: "2026-09-20", expense_id: "e-oct" }), // cobrada en septiembre, pagada en octubre: solo «pagadas»
      row({ amount: 70, paid_on: "2026-09-20", expense_id: "e-sep" }), // todo septiembre: ninguna
      row({ amount: 99, expense_id: "e-prog" }), // en gasto programado: generada, no pagada
    ]);
    expect(mineSummary(rows, TODAY)).toEqual({ generatedCents: (300 + 520 + 99) * 100, paidCents: (520 + 40) * 100 });
  });

  it("las anuladas no cuentan en ninguna", () => {
    const rows = classify([row({ amount: 100, voided_at: "2026-10-11T00:00:00Z" }), row({ amount: 5 })]);
    expect(mineSummary(rows, TODAY)).toEqual({ generatedCents: 500, paidCents: 0 });
  });

  it("un ajuste negativo resta de lo generado", () => {
    const rows = classify([row({ amount: 50 }), row({ amount: -20, kind: "adjustment", role: null })]);
    expect(mineSummary(rows, TODAY).generatedCents).toBe(3000);
  });

  it("sin filas es cero, y el texto lo dice con dos decimales", () => {
    const summary = mineSummary([], TODAY);
    expect(summary).toEqual({ generatedCents: 0, paidCents: 0 });
    expect(mineSummaryText(summary)).toBe("Este mes: USD 0,00 generados · USD 0,00 pagados");
    expect(mineSummaryText({ generatedCents: 82000, paidCents: 54000 })).toBe("Este mes: USD 820,00 generados · USD 540,00 pagados");
  });
});
