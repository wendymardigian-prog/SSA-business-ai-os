import { describe, expect, it } from "vitest";
import { contactListPlan, parseContactListFilters } from "../list-query";
import { paymentsCell, saleCells } from "./sales";

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

describe("ventas: registros relacionados", () => {
  const P = "9f0d1b6e-1111-2222-3333-444455556666";
  it("producto comprado busca por la variante de la venta", () => {
    const p = contactListPlan(parseContactListFilters({ venta: "si", producto_comprado: P }, []));
    expect(p.embeds).toEqual(["con_sales:sales!inner(id,product_variants!inner(product_id))"]);
    expect(p.clauses).toContainEqual({ op: "in", column: "con_sales.product_variants.product_id", values: [P] });
  });

  it("las columnas: lo anulado no suma al total, lo cobrado es neto", () => {
    const rows = [
      { contact_id: P, status: "paid", sale_date: "2026-11-01", final_amount: "1000.50", product_snapshot: { product_name: "Mentoría" }, payments: [{ amount: 1000.5, status: "paid" }] },
      { contact_id: P, status: "refunded", sale_date: "2026-10-01", final_amount: 500, product_snapshot: {}, payments: [{ amount: 500, status: "paid" }, { amount: -500, status: "paid" }] },
    ];
    const cells = saleCells([P], ["sales_count", "sales_total", "sales_paid", "last_product", "last_sale_status"], rows)[P];
    expect(cells.sales_count).toEqual({ t: "number", n: 2, sub: "1 vigente" });
    expect(cells.sales_total).toEqual({ t: "money", cents: 100050 });
    expect(cells.sales_paid).toEqual({ t: "money", cents: 100050 });
    expect(cells.last_product).toEqual({ t: "text", text: "Mentoría" });
    expect(cells.last_sale_status && cells.last_sale_status.t).toBe("date");
  });
});
