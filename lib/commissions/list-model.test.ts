import { describe, expect, it } from "vitest";
import { emptyCommissionFilters } from "./filters";
import { applyDerivedFilters, classifyRows, groupRows, inPill, paginate, pillSummary, sortRows, statusTotals, type ExpenseRef, type LightCommission, type SaleLink } from "./list-model";

const TODAY = "2026-10-15";
let n = 0;
const row = (patch: Partial<LightCommission> = {}): LightCommission => {
  n += 1;
  return {
    id: `c${String(n).padStart(3, "0")}`, kind: "earned", role: "vendedor", user_id: "u1", payment_id: "p", sale_id: "s1", rule_id: "r", amount: 10, base_amount: 100,
    paid_on: "2026-10-10", available_on: "2026-10-10", expense_id: null, voided_at: null, created_at: `2026-10-10T10:00:${String(n % 60).padStart(2, "0")}Z`, ...patch,
  };
};
const exp = (id: string, status: string, paid: string | null = null, scheduled: string | null = "2026-10-20"): [string, ExpenseRef] => [id, { expense_id: id, status, scheduled_date: scheduled, paid_date: paid }];
const sales = new Map<string, SaleLink>([["s1", { contact_id: "k1", product_id: "pr1" }], ["s2", { contact_id: "k2", product_id: "pr2" }]]);
const expenses = new Map<string, ExpenseRef>([exp("e-pagado", "pagado", "2026-10-12"), exp("e-prog", "programado"), exp("e-viejo", "pagado", "2026-08-30")]);

const rows = [
  row({ id: "pend" }),
  row({ id: "ret", available_on: "2026-11-01" }),
  row({ id: "sinp", user_id: null }),
  row({ id: "anul", voided_at: "2026-10-11T00:00:00Z" }),
  row({ id: "gasto", expense_id: "e-prog" }),
  row({ id: "pag-mes", expense_id: "e-pagado", sale_id: "s2" }),
  row({ id: "pag-viejo", expense_id: "e-viejo", amount: 5 }),
  row({ id: "ajuste", kind: "adjustment", role: null, amount: -4, sale_id: null }),
];
const classified = classifyRows(rows, expenses, sales, TODAY);
const byId = (id: string) => classified.find((r) => r.commission.id === id)!;

describe("classifyRows", () => {
  it("calcula el estado de cada una con su gasto y la fecha de hoy", () => {
    expect(classified.map((r) => [r.commission.id, r.status.key])).toEqual([
      ["pend", "pendiente"], ["ret", "retenida"], ["sinp", "sin_persona"], ["anul", "anulada"], ["gasto", "en_gasto"], ["pag-mes", "pagada"], ["pag-viejo", "pagada"], ["ajuste", "pendiente"],
    ]);
  });
  it("pasa el monto a céntimos (negativo en un ajuste) y trae contacto y producto de la venta", () => {
    expect(byId("ajuste").amountCents).toBe(-400);
    expect(byId("pend")).toMatchObject({ amountCents: 1000, contactId: "k1", productId: "pr1" });
    expect(byId("ajuste")).toMatchObject({ contactId: null, productId: null });
  });
  it("una comisión en un gasto que no se cargó sigue siendo «En gasto»", () => {
    const [r] = classifyRows([row({ expense_id: "fantasma" })], new Map(), sales, TODAY);
    expect(r.status.key).toBe("en_gasto");
  });
});

describe("filtros que dependen del estado", () => {
  const f = emptyCommissionFilters();
  it("estado: uno o varios", () => {
    expect(applyDerivedFilters(classified, { ...f, statuses: ["retenida", "anulada"] }, TODAY).map((r) => r.commission.id)).toEqual(["ret", "anul"]);
  });
  it("«Pendientes» incluye las retenidas", () => {
    expect(applyDerivedFilters(classified, { ...f, pill: "pendientes" }, TODAY).map((r) => r.commission.id)).toEqual(["pend", "ret", "ajuste"]);
  });
  it("«Pagadas este mes» mira cuándo se pagó el gasto, no el cobro", () => {
    expect(applyDerivedFilters(classified, { ...f, pill: "pagadas_mes" }, TODAY).map((r) => r.commission.id)).toEqual(["pag-mes"]);
    expect(inPill(byId("pag-viejo"), "pagadas_mes", TODAY)).toBe(false);
  });
  it("pastilla y estado juntos se intersectan", () => {
    expect(applyDerivedFilters(classified, { ...f, pill: "pendientes", statuses: ["retenida"] }, TODAY).map((r) => r.commission.id)).toEqual(["ret"]);
  });
  it("producto y contacto salen de la venta", () => {
    expect(applyDerivedFilters(classified, { ...f, products: ["pr2"] }, TODAY).map((r) => r.commission.id)).toEqual(["pag-mes"]);
    expect(applyDerivedFilters(classified, { ...f, contactId: "k2" }, TODAY).map((r) => r.commission.id)).toEqual(["pag-mes"]);
  });
  it("skipStatus ignora la pastilla y el estado (para contar las pastillas)", () => {
    expect(applyDerivedFilters(classified, { ...f, pill: "anuladas", statuses: ["anulada"], products: ["pr1"] }, TODAY, { skipStatus: true }).map((r) => r.commission.id)).toContain("pend");
  });
});

describe("totales, pastillas y grupos", () => {
  it("los totales por estado suman en céntimos y no cuentan las anuladas en el total", () => {
    const t = statusTotals(classified);
    expect(t.byStatus.pendiente).toEqual({ count: 2, cents: 1000 - 400 });
    expect(t.byStatus.anulada).toEqual({ count: 1, cents: 1000 });
    expect(t.total).toEqual({ count: 7, cents: 1000 + 1000 + 1000 + 1000 + 1000 + 500 - 400 });
  });
  it("las pastillas cuentan cada una su estado", () => {
    const p = pillSummary(classified, TODAY);
    expect(p.pendientes).toEqual({ count: 3, cents: 1000 + 1000 - 400 });
    expect(p.en_gasto.count).toBe(1);
    expect(p.pagadas_mes.count).toBe(1);
    expect(p.sin_persona.count).toBe(1);
    expect(p.anuladas.count).toBe(1);
  });
  it("agrupar por persona deja afuera las anuladas y ordena por monto", () => {
    const g = groupRows(classified, "persona");
    expect(g.find((x) => x.key === "none")).toMatchObject({ count: 1, cents: 1000 });
    expect(g.find((x) => x.key === "u1")?.count).toBe(6);
    expect(g.map((x) => x.cents)).toEqual([...g.map((x) => x.cents)].sort((a, b) => b - a));
  });
  it("agrupar por estado sí cuenta las anuladas, en el orden de los estados", () => {
    const g = groupRows(classified, "estado");
    expect(g.map((x) => x.key)).toEqual(["anulada", "sin_persona", "pagada", "en_gasto", "retenida", "pendiente"]);
  });
  it("agrupar por mes y por producto", () => {
    expect(groupRows(classified, "mes").map((x) => x.key)).toEqual(["2026-10"]);
    expect(groupRows(classified, "producto").find((x) => x.key === "pr2")?.count).toBe(1);
    expect(groupRows(classified, "gasto").find((x) => x.key === "e-prog")?.count).toBe(1);
  });
});

describe("orden y página", () => {
  it("lo más nuevo primero; sin fecha de cobro al final", () => {
    const list = classifyRows([row({ id: "vieja", paid_on: "2026-09-01" }), row({ id: "sin", paid_on: null }), row({ id: "nueva", paid_on: "2026-10-14" })], new Map(), sales, TODAY);
    expect(sortRows(list).map((r) => r.commission.id)).toEqual(["nueva", "vieja", "sin"]);
  });
  it("desempata por alta y por id, siempre igual", () => {
    const a = row({ id: "a", paid_on: "2026-10-01", created_at: "2026-10-01T10:00:00Z" });
    const b = row({ id: "b", paid_on: "2026-10-01", created_at: "2026-10-01T11:00:00Z" });
    expect(sortRows(classifyRows([a, b], new Map(), sales, TODAY)).map((r) => r.commission.id)).toEqual(["b", "a"]);
  });
  it("pagina de a 50 y no se pasa de la última página", () => {
    const list = Array.from({ length: 120 }, (_, i) => i);
    expect(paginate(list, 1).rows).toHaveLength(50);
    expect(paginate(list, 3)).toMatchObject({ page: 3, pages: 3 });
    expect(paginate(list, 3).rows).toHaveLength(20);
    expect(paginate(list, 9)).toMatchObject({ page: 3 });
    expect(paginate([], 1)).toEqual({ rows: [], page: 1, pages: 1 });
    expect(paginate(list, -2).page).toBe(1);
  });
});
