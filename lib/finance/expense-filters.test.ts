import { describe, expect, it } from "vitest";
import { DEFAULT_EXPENSE_CATEGORIES } from "./categories";
import { emptyExpenseFilters, expenseConditions, expensesHref, parseExpenseFilters, pillConditions, serializeExpenseFilters } from "./expense-filters";

const V1 = "11111111-1111-4111-8111-111111111111";

describe("parse / serialize", () => {
  it("serialize(parse(x)) === x para una URL canónica", () => {
    const raw = `pastilla=vencidos&estado=vencido,programado&categoria=marketing,software&grupo=operacion&proveedor=${V1}&origen=manual,recurring&fecha=pago&desde=2026-10-01&hasta=2026-10-31&q=agencia&agrupar=proveedor&pagina=3`;
    const x = new URLSearchParams(raw).toString(); // la forma canónica codifica las comas
    expect(serializeExpenseFilters(parseExpenseFilters(new URLSearchParams(x)))).toBe(x);
  });
  it("lo inválido se descarta en silencio", () => {
    const f = parseExpenseFilters({ pastilla: "x", estado: "raro,pagado", categoria: "MAL KEY,ok_key", grupo: "nada", proveedor: "no-uuid", desde: "2026-13-45", pagina: "-4", agrupar: "mes" });
    expect(f.pill).toBeNull();
    expect(f.statuses).toEqual(["pagado"]);
    expect(f.categories).toEqual(["ok_key"]);
    expect(f.group).toBeNull();
    expect(f.vendors).toEqual([]);
    expect(f.from).toBeNull();
    expect(f.page).toBe(1);
    expect(f.groupBy).toBeNull();
  });
  it("el vacío no deja nada en la URL", () => {
    expect(serializeExpenseFilters(emptyExpenseFilters())).toBe("");
    expect(expensesHref({})).toBe("/dashboard/finanzas/gastos");
    expect(expensesHref({ pill: "vencidos" })).toBe("/dashboard/finanzas/gastos?pastilla=vencidos");
  });
});

describe("pastillas", () => {
  it("«Por pagar esta semana» un miércoles lista programados de miércoles a domingo (no los vencidos)", () => {
    // 2026-10-14 es miércoles
    const c = pillConditions("por_pagar_semana", "2026-10-14");
    expect(c).toContainEqual({ kind: "eq", column: "status", value: "programado" });
    expect(c).toContainEqual({ kind: "gte", column: "scheduled_date", value: "2026-10-14" });
    expect(c).toContainEqual({ kind: "lte", column: "scheduled_date", value: "2026-10-18" });
  });
  it("«Pagados este mes» usa la fecha de pago del mes local", () => {
    const c = pillConditions("pagados_mes", "2026-02-10");
    expect(c).toContainEqual({ kind: "gte", column: "paid_date", value: "2026-02-01" });
    expect(c).toContainEqual({ kind: "lte", column: "paid_date", value: "2026-02-28" });
  });
});

describe("expenseConditions", () => {
  it("filtrar por grupo lista las categorías que HOY están en ese grupo", () => {
    const cats = DEFAULT_EXPENSE_CATEGORIES.map((c) => (c.key === "software" ? { ...c, group: "adquisicion" as const } : c));
    const conds = expenseConditions({ ...emptyExpenseFilters(), group: "adquisicion" }, "2026-10-10", cats);
    const inCat = conds.find((c) => c.kind === "in" && c.column === "category_key");
    expect(inCat && "values" in inCat && inCat.values).toContain("software");
    expect(inCat && "values" in inCat && inCat.values).toContain("commissions");
  });
  it("el rango se aplica sobre la fecha elegida", () => {
    const conds = expenseConditions({ ...emptyExpenseFilters(), dateField: "pago", from: "2026-10-01", to: "2026-10-31" }, "2026-10-10", DEFAULT_EXPENSE_CATEGORIES);
    expect(conds).toContainEqual({ kind: "gte", column: "paid_date", value: "2026-10-01" });
    expect(conds).toContainEqual({ kind: "lte", column: "paid_date", value: "2026-10-31" });
  });
  it("un grupo sin categorías no trae todo: trae nada", () => {
    const conds = expenseConditions({ ...emptyExpenseFilters(), group: "entrega", categories: ["marketing"] }, "2026-10-10", DEFAULT_EXPENSE_CATEGORIES);
    const inCat = conds.find((c) => c.kind === "in" && c.column === "category_key");
    expect(inCat && "values" in inCat && inCat.values).toEqual(["__ninguna__"]);
  });
});
