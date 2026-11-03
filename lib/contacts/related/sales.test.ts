import { describe, expect, it } from "vitest";
import { contactListPlan, parseContactListFilters } from "../list-query";
import { paymentsCell } from "./sales";

const clauses = (params: Record<string, string>) =>
  contactListPlan(parseContactListFilters(params, [])).clauses.filter((c) => !("column" in c && c.column === "is_anonymous"));

describe("ventas en la lista de contactos", () => {
  it("pago en mora: sí es la marca en true; no incluye a quien no tiene salud de pago", () => {
    expect(clauses({ mora: "si" })).toEqual([{ op: "eq", column: "payment_health->>has_active_overdue", value: "true" }]);
    expect(clauses({ mora: "no" })).toEqual([
      { op: "or", filter: "payment_health->>has_active_overdue.is.null,payment_health->>has_active_overdue.neq.true" },
    ]);
    expect(clauses({ mora: "quizas" })).toEqual([]);
  });

  it("la columna Pagos: en mora, al día o vacía", () => {
    expect(paymentsCell({ payment_health: { has_active_overdue: true, total_paid: 2 } })).toEqual({ t: "badge", text: "En mora", tone: "red", sub: "2 pagos cobrados" });
    expect(paymentsCell({ payment_health: { has_active_overdue: false, total_paid: 1 } })).toEqual({ t: "badge", text: "Al día", tone: "green", sub: "1 pago cobrado" });
    expect(paymentsCell({ payment_health: {} })).toBeNull();
    expect(paymentsCell({ payment_health: null })).toBeNull();
  });
});
