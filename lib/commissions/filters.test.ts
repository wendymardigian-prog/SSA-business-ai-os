import { describe, expect, it } from "vitest";
import { commissionsHref, countActiveCommissionFilters, emptyCommissionFilters, paidRange, parseCommissionFilters, serializeCommissionFilters, totalsByStatus, type TotalsRow } from "./filters";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("parse / serialize", () => {
  it("serialize(parse(x)) === x para una URL canónica", () => {
    const raw = `pastilla=pendientes&persona=${U1},${U2}&rol=vendedor,marketing&estado=pendiente,retenida&mes=2026-10&producto=${U1}&venta=${U2}&contacto=${U1}&gasto=${U2}&regla=${U1}&agrupar=persona&pagina=3`;
    const x = new URLSearchParams(raw).toString();
    expect(serializeCommissionFilters(parseCommissionFilters(new URLSearchParams(x)))).toBe(x);
  });
  it("con rango de fechas en vez de mes", () => {
    const x = new URLSearchParams("desde=2026-10-01&hasta=2026-10-15&agrupar=rol").toString();
    expect(serializeCommissionFilters(parseCommissionFilters(new URLSearchParams(x)))).toBe(x);
  });
  it("sin nada, la cadena es vacía y los filtros son los vacíos", () => {
    expect(serializeCommissionFilters(emptyCommissionFilters())).toBe("");
    expect(parseCommissionFilters({})).toEqual(emptyCommissionFilters());
  });
  it("lo inválido se descarta en silencio", () => {
    const f = parseCommissionFilters({ pastilla: "x", persona: "no-uuid", rol: "MAL KEY,ok_key", estado: "raro,pagada", mes: "2026-13", desde: "2026-13-45", producto: "x", venta: "x", gasto: "x", agrupar: "color", pagina: "-4" });
    expect(f.pill).toBeNull();
    expect(f.users).toEqual([]);
    expect(f.roles).toEqual(["ok_key"]);
    expect(f.statuses).toEqual(["pagada"]);
    expect(f.month).toBeNull();
    expect(f.from).toBeNull();
    expect(f.products).toEqual([]);
    expect(f.saleId).toBeNull();
    expect(f.expenseId).toBeNull();
    expect(f.groupBy).toBeNull();
    expect(f.page).toBe(1);
  });
  it("sin repetidos", () => {
    expect(parseCommissionFilters({ persona: `${U1},${U1}`, estado: "pagada,pagada" })).toMatchObject({ users: [U1], statuses: ["pagada"] });
  });
  it("con mes, desde/hasta se ignoran (la forma canónica no mezcla)", () => {
    const f = parseCommissionFilters({ mes: "2026-10", desde: "2026-10-01", hasta: "2026-10-05" });
    expect(f).toMatchObject({ month: "2026-10", from: null, to: null });
    expect(serializeCommissionFilters(f)).toBe("mes=2026-10");
  });
  it("lee un objeto de searchParams de Next (valores sueltos o listas)", () => {
    expect(parseCommissionFilters({ rol: ["vendedor", "setter"], pagina: "2" })).toMatchObject({ roles: ["vendedor"], page: 2 });
  });
  it("cada estado y cada agrupación válidos pasan", () => {
    for (const g of ["persona", "rol", "mes", "producto", "estado", "gasto"]) expect(parseCommissionFilters({ agrupar: g }).groupBy).toBe(g);
    for (const e of ["anulada", "sin_persona", "pagada", "en_gasto", "retenida", "pendiente"]) expect(parseCommissionFilters({ estado: e }).statuses).toEqual([e]);
  });
});

describe("helpers", () => {
  it("countActiveCommissionFilters no cuenta agrupar ni página", () => {
    expect(countActiveCommissionFilters(emptyCommissionFilters())).toBe(0);
    expect(countActiveCommissionFilters({ ...emptyCommissionFilters(), users: [U1], month: "2026-10", groupBy: "rol", page: 4 })).toBe(2);
    expect(countActiveCommissionFilters({ ...emptyCommissionFilters(), from: "2026-10-01", to: "2026-10-05" })).toBe(1);
  });
  it("paidRange: el mes completo, o el rango", () => {
    expect(paidRange({ month: "2026-02", from: null, to: null })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(paidRange({ month: null, from: "2026-10-03", to: null })).toEqual({ from: "2026-10-03", to: null });
  });
  it("commissionsHref arma el link con el filtro puesto", () => {
    expect(commissionsHref({})).toBe("/dashboard/finanzas/comisiones");
    expect(commissionsHref({ saleId: U1 })).toBe(`/dashboard/finanzas/comisiones?venta=${U1}`);
  });
});

describe("totalsByStatus", () => {
  const rows: TotalsRow[] = [
    { status: "pendiente", amountCents: 3882 },
    { status: "retenida", amountCents: 2500 },
    { status: "en_gasto", amountCents: 1500 },
    { status: "pagada", amountCents: 1000 },
    { status: "sin_persona", amountCents: 500 },
    { status: "anulada", amountCents: 9999 },
    { status: "pendiente", amountCents: -1941 },
  ];
  it("cuenta y suma por estado, en céntimos", () => {
    const t = totalsByStatus(rows);
    expect(t.byStatus.pendiente).toEqual({ count: 2, cents: 1941 });
    expect(t.byStatus.retenida).toEqual({ count: 1, cents: 2500 });
    expect(t.byStatus.anulada).toEqual({ count: 1, cents: 9999 });
  });
  it("el total no incluye las anuladas", () => {
    expect(totalsByStatus(rows).total).toEqual({ count: 6, cents: 3882 + 2500 + 1500 + 1000 + 500 - 1941 });
  });
  it("120 comisiones suman las 120", () => {
    const many: TotalsRow[] = Array.from({ length: 120 }, (_, i) => ({ status: i % 2 ? "pendiente" : "pagada", amountCents: 100 }));
    const t = totalsByStatus(many);
    expect(t.total).toEqual({ count: 120, cents: 12000 });
    expect(t.byStatus.pendiente.count + t.byStatus.pagada.count).toBe(120);
  });
  it("sin filas, todo en cero; un monto raro no rompe", () => {
    const t = totalsByStatus([]);
    expect(t.total).toEqual({ count: 0, cents: 0 });
    expect(Object.values(t.byStatus).every((b) => b.count === 0 && b.cents === 0)).toBe(true);
    expect(totalsByStatus([{ status: "pagada", amountCents: Number.NaN }]).total.cents).toBe(0);
  });
  it("no depende de que el estado exista: lo desconocido se ignora", () => {
    expect(totalsByStatus([{ status: "raro" as never, amountCents: 5 }]).total.count).toBe(0);
  });
});
