import { describe, expect, it } from "vitest";
import { DEFAULT_EXPENSE_CATEGORIES, type ExpenseCategory } from "./categories";
import {
  allocatePct,
  byCategory,
  byGroup,
  cac,
  cashRevenue,
  deltaPct,
  marginPct,
  monthlyTrend,
  paidExpenses,
  result,
  topVendors,
  trendMonths,
  upcomingByWeek,
  type MetricExpense,
  type MetricPayment,
} from "./metrics";

const pay = (over: Partial<MetricPayment>): MetricPayment => ({ type: "installment", status: "paid", amount: 100, paid_at: "2026-10-05T15:00:00Z", ...over });
const exp = (over: Partial<MetricExpense>): MetricExpense => ({ status: "pagado", amount: 10, category_key: "software", vendor_id: null, paid_date: "2026-10-05", scheduled_date: "2026-10-05", ...over });

describe("cashRevenue", () => {
  it("suma en céntimos exactos: 416,67 + 416,67 + 416,66 = 1.250,00", () => {
    const r = cashRevenue([pay({ amount: 416.67 }), pay({ amount: 416.67 }), pay({ amount: 416.66 })]);
    expect(r.netCents).toBe(125000);
    expect(r.grossCents).toBe(125000);
    expect(r.refundsCents).toBe(0);
  });

  it("un reembolso total resta una sola vez: el pago sigue paid y la fila refund es negativa", () => {
    const r = cashRevenue([pay({ amount: 1000 }), pay({ type: "refund", amount: -1000 })]);
    expect(r).toEqual({ grossCents: 100000, refundsCents: -100000, netCents: 0 });
  });

  it("un reembolso parcial de 200 sobre 1.000 deja 800", () => {
    const r = cashRevenue([pay({ amount: 1000 }), pay({ type: "refund", amount: -200 })]);
    expect(r.netCents).toBe(80000);
    expect(r.refundsCents).toBe(-20000);
  });

  it("scheduled, overdue, uncollectible y cancelled no suman (tampoco un refund cancelado)", () => {
    const r = cashRevenue([
      pay({ status: "scheduled" }),
      pay({ status: "overdue" }),
      pay({ status: "uncollectible" }),
      pay({ status: "cancelled" }),
      pay({ status: "cancelled", type: "refund", amount: -100 }),
    ]);
    expect(r).toEqual({ grossCents: 0, refundsCents: 0, netCents: 0 });
  });

  it("sin pagos todo es 0", () => {
    expect(cashRevenue([])).toEqual({ grossCents: 0, refundsCents: 0, netCents: 0 });
  });
});

describe("paidExpenses y result", () => {
  it("solo suma pagado; anulado y por revisar nunca", () => {
    expect(paidExpenses([exp({ amount: 50 }), exp({ status: "anulado", amount: 999 }), exp({ status: "por_revisar", amount: 0 }), exp({ status: "programado", amount: 70 }), exp({ status: "vencido", amount: 80 })])).toBe(5000);
  });

  it("un ajuste negativo resta con su signo", () => {
    expect(paidExpenses([exp({ amount: 50 }), exp({ amount: -4.2 })])).toBe(4580);
  });

  it("resultado = neto − gastos", () => {
    expect(result(1240000, 315000)).toBe(925000);
    expect(result(100, 300)).toBe(-200);
  });
});

describe("marginPct y deltaPct", () => {
  it("marginPct con un decimal", () => {
    expect(marginPct(925000, 1240000)).toBe(74.6);
    expect(marginPct(-200, 1000)).toBe(-20);
  });
  it("marginPct sin ingreso es null, no 0", () => {
    expect(marginPct(0, 0)).toBeNull();
    expect(marginPct(-500, 0)).toBeNull();
  });
  it("deltaPct con un decimal", () => {
    expect(deltaPct(120, 100)).toBe(20);
    expect(deltaPct(50, 100)).toBe(-50);
    expect(deltaPct(100, 100)).toBe(0);
  });
  it("deltaPct sin anterior es null", () => {
    expect(deltaPct(100, 0)).toBeNull();
  });
  it("deltaPct con un anterior negativo divide por su valor absoluto", () => {
    expect(deltaPct(50, -100)).toBe(150);
  });
});

describe("allocatePct", () => {
  it("suma exacta 100,0 y el mayor absorbe el redondeo", () => {
    const p = allocatePct([1, 1, 1]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
    expect(p).toEqual([33.4, 33.3, 33.3]);
  });
  it("con total 0 todo es 0", () => {
    expect(allocatePct([0, 0])).toEqual([0, 0]);
  });
});

// Suma de decimales sin error de flotante: en décimas enteras.
const sumTenths = (xs: number[]) => xs.reduce((a, b) => a + Math.round(b * 10), 0);

describe("byCategory", () => {
  const cats: ExpenseCategory[] = DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c }));

  it("10 categorías: suma exacta del total y pct exactamente 100,0", () => {
    const keys = ["ads_meta", "marketing", "sales_team", "delivery_team", "delivery_tools", "software", "processor_fees", "professional", "admin_team", "taxes"];
    const expenses = keys.map((k, i) => exp({ category_key: k, amount: 100 + i * 7.31 }));
    const rows = byCategory(expenses, cats);
    expect(rows).toHaveLength(10);
    expect(rows.reduce((a, r) => a + r.cents, 0)).toBe(paidExpenses(expenses));
    expect(sumTenths(rows.map((r) => r.pct))).toBe(1000);
  });

  it("ordena de mayor a menor y lleva nombre, color y grupo de la categoría", () => {
    const rows = byCategory([exp({ category_key: "software", amount: 10 }), exp({ category_key: "ads_meta", amount: 90 }), exp({ category_key: "ads_meta", amount: 10 })], cats);
    expect(rows.map((r) => r.categoryKey)).toEqual(["ads_meta", "software"]);
    expect(rows[0]).toMatchObject({ name: "Publicidad (Meta)", color: "#2563eb", group: "adquisicion", cents: 10000, count: 2, pct: 90.9 });
    expect(rows[1].pct).toBe(9.1);
  });

  it("no cuenta anulados ni por revisar y una clave desconocida cae en 'otro'", () => {
    const rows = byCategory([exp({ category_key: "vieja", amount: 10 }), exp({ category_key: "software", amount: 500, status: "anulado" })], cats);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ categoryKey: "vieja", name: "vieja", group: "otro", pct: 100 });
  });

  it("sin gastos devuelve vacío", () => {
    expect(byCategory([], cats)).toEqual([]);
  });
});

describe("byGroup", () => {
  const cats = DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c }));

  it("los 4 grupos siempre, en 0 si no hay gasto", () => {
    const rows = byGroup([], cats);
    expect(rows.map((r) => r.group)).toEqual(["adquisicion", "entrega", "operacion", "otro"]);
    expect(rows.every((r) => r.cents === 0 && r.pct === 0)).toBe(true);
  });

  it("suma por grupo, pct 100,0 y la suma de los grupos = gastos pagados", () => {
    const expenses = [exp({ category_key: "ads_meta", amount: 580 }), exp({ category_key: "marketing", amount: 0.01 }), exp({ category_key: "software", amount: 300 }), exp({ category_key: "delivery_team", amount: 120 }), exp({ category_key: "taxes", amount: 50 }), exp({ category_key: "software", amount: 999, status: "anulado" })];
    const rows = byGroup(expenses, cats);
    expect(rows.reduce((a, r) => a + r.cents, 0)).toBe(paidExpenses(expenses));
    expect(sumTenths(rows.map((r) => r.pct))).toBe(1000);
    expect(rows[0]).toMatchObject({ group: "adquisicion", label: "Adquisición", cents: 58001 });
  });
});

describe("topVendors", () => {
  const vendors = Array.from({ length: 12 }, (_, i) => ({ id: `v${i + 1}`, name: `Proveedor ${i + 1}`, archived_at: null }));

  it("12 proveedores: devuelve 10 ordenados y 'sin proveedor' no compite", () => {
    const expenses = [...vendors.map((v, i) => exp({ vendor_id: v.id, amount: (i + 1) * 10 })), exp({ vendor_id: null, amount: 100000 })];
    const t = topVendors(expenses, vendors);
    expect(t.top).toHaveLength(10);
    expect(t.top[0].vendorId).toBe("v12");
    expect(t.top.map((x) => x.cents)).toEqual([...t.top.map((x) => x.cents)].sort((a, b) => b - a));
    expect(t.top.some((x) => x.name === "Sin proveedor")).toBe(false);
    expect(t.withoutVendor).toMatchObject({ count: 1, cents: 10000000 });
    expect(t.totalCents).toBe(10000000 + 78 * 1000);
  });

  it("cuenta pagos por proveedor, % del gasto y marca archivados", () => {
    const t = topVendors([exp({ vendor_id: "a", amount: 75 }), exp({ vendor_id: "a", amount: 25 }), exp({ vendor_id: "b", amount: 100 })], [
      { id: "a", name: "Meta", archived_at: null },
      { id: "b", name: "Vieja", archived_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(t.top[0]).toMatchObject({ vendorId: "a", count: 2, cents: 10000, pct: 50 });
    expect(t.top[1].name).toBe("Vieja (archivado)");
  });

  it("n más chico que la cantidad", () => {
    expect(topVendors(vendors.map((v) => exp({ vendor_id: v.id })), vendors, 3).top).toHaveLength(3);
  });
});

describe("monthlyTrend", () => {
  it("trendMonths: 6 meses terminando en el actual, cruzando el año", () => {
    expect(trendMonths("2026-10-15")).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(trendMonths("2026-02-01", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("un mes sin datos en el medio queda en 0 (no ausente)", () => {
    const months = trendMonths("2026-10-15");
    const t = monthlyTrend(
      [pay({ amount: 500, paid_at: "2026-05-10T12:00:00Z" }), pay({ amount: 700, paid_at: "2026-10-02T12:00:00Z" })],
      [exp({ amount: 100, paid_date: "2026-05-20" }), exp({ amount: 40, paid_date: "2026-10-03" })],
      months,
      "America/Costa_Rica",
    );
    expect(t).toHaveLength(6);
    const jul = t.find((p) => p.month === "2026-07")!;
    expect(jul).toEqual({ month: "2026-07", revenueCents: 0, expensesCents: 0, resultCents: 0 });
    expect(t[0]).toEqual({ month: "2026-05", revenueCents: 50000, expensesCents: 10000, resultCents: 40000 });
    expect(t[5]).toEqual({ month: "2026-10", revenueCents: 70000, expensesCents: 4000, resultCents: 66000 });
  });

  it("el mes de un pago sale de la zona del workspace (23:30 del 30/9 en Costa Rica es septiembre)", () => {
    const months = ["2026-09", "2026-10"];
    const t = monthlyTrend([pay({ amount: 10, paid_at: "2026-10-01T05:30:00Z" })], [], months, "America/Costa_Rica");
    expect(t[0].revenueCents).toBe(1000);
    expect(t[1].revenueCents).toBe(0);
    // En UTC ese mismo instante ya es octubre.
    expect(monthlyTrend([pay({ amount: 10, paid_at: "2026-10-01T05:30:00Z" })], [], months, "UTC")[1].revenueCents).toBe(1000);
  });

  it("ignora lo que no está pagado y lo que cae fuera de la ventana", () => {
    const t = monthlyTrend([pay({ status: "scheduled", paid_at: null }), pay({ paid_at: "2025-01-01T00:00:00Z" })], [exp({ status: "anulado", paid_date: null })], ["2026-10"], "UTC");
    expect(t).toEqual([{ month: "2026-10", revenueCents: 0, expensesCents: 0, resultCents: 0 }]);
  });

  it("los reembolsos restan del mes en que se cobraron", () => {
    const t = monthlyTrend([pay({ amount: 1000, paid_at: "2026-10-01T12:00:00Z" }), pay({ type: "refund", amount: -200, paid_at: "2026-10-09T12:00:00Z" })], [], ["2026-10"], "UTC");
    expect(t[0].revenueCents).toBe(80000);
  });
});

describe("cac", () => {
  it("sin ventas nuevas es null", () => {
    expect(cac(150000, 0)).toBeNull();
  });
  it("USD 1.500 en 4 ventas = USD 375,00", () => {
    expect(cac(150000, 4)).toBe(37500);
  });
  it("redondea al céntimo", () => {
    expect(cac(10000, 3)).toBe(3333);
  });
});

describe("upcomingByWeek", () => {
  const today = "2026-10-14"; // miércoles

  it("agrupa los programados por semana lunes–domingo, de la más próxima a la más lejana", () => {
    const u = upcomingByWeek(
      [
        exp({ status: "programado", amount: 100, scheduled_date: "2026-10-14" }),
        exp({ status: "programado", amount: 50, scheduled_date: "2026-10-18" }),
        exp({ status: "programado", amount: 25, scheduled_date: "2026-10-19" }),
        exp({ status: "programado", amount: 5, scheduled_date: "2026-11-05" }),
      ],
      today,
    );
    expect(u.weeks).toEqual([
      { weekStart: "2026-10-12", weekEnd: "2026-10-18", count: 2, cents: 15000 },
      { weekStart: "2026-10-19", weekEnd: "2026-10-25", count: 1, cents: 2500 },
      { weekStart: "2026-11-02", weekEnd: "2026-11-08", count: 1, cents: 500 },
    ]);
    expect(u.from).toBe("2026-10-14");
    expect(u.to).toBe("2026-11-13");
  });

  it("un gasto a 31 días no entra; a 30 días sí", () => {
    const u = upcomingByWeek([exp({ status: "programado", scheduled_date: "2026-11-14" }), exp({ status: "programado", scheduled_date: "2026-11-13" })], today);
    expect(u.weeks.reduce((a, w) => a + w.count, 0)).toBe(1);
  });

  it("un vencido y dos programados en semanas distintas: tres baldes", () => {
    const u = upcomingByWeek(
      [exp({ status: "vencido", amount: 40, scheduled_date: "2026-10-01" }), exp({ status: "programado", amount: 10, scheduled_date: "2026-10-15" }), exp({ status: "programado", amount: 20, scheduled_date: "2026-10-22" })],
      today,
    );
    expect(u.overdue).toEqual({ count: 1, cents: 4000 });
    expect(u.weeks).toHaveLength(2);
  });

  it("un programado con fecha pasada cuenta como vencido (el trabajo de vencimiento aún no corrió)", () => {
    const u = upcomingByWeek([exp({ status: "programado", amount: 10, scheduled_date: "2026-10-13" })], today);
    expect(u.overdue).toEqual({ count: 1, cents: 1000 });
    expect(u.weeks).toEqual([]);
  });

  it("por revisar se cuenta aparte, sin monto; pagado y anulado no entran", () => {
    const u = upcomingByWeek(
      [exp({ status: "por_revisar", amount: 0, scheduled_date: "2026-10-20" }), exp({ status: "por_revisar", amount: 0, scheduled_date: "2027-01-20" }), exp({ status: "pagado", scheduled_date: "2026-10-20" }), exp({ status: "anulado", scheduled_date: "2026-10-20" })],
      today,
    );
    expect(u.toReview).toEqual({ count: 2 });
    expect(u.weeks).toEqual([]);
    expect(u.overdue).toEqual({ count: 0, cents: 0 });
  });
});
