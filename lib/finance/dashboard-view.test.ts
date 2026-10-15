import { describe, expect, it } from "vitest";
import type { ChartSeries } from "@/components/dashboards/charts";
import { resolvePeriod, previousPeriod } from "@/lib/dashboards/period";
import { parseExpenseFilters } from "./expense-filters";
import {
  buildCacCard,
  buildDrilldownHref,
  buildGroupBars,
  buildSummaryCards,
  buildSummaryMetrics,
  buildTrendSeries,
  buildUpcomingRows,
  formatSignedPct,
  weekRangeLabel,
} from "./dashboard-view";
import { DEFAULT_EXPENSE_CATEGORIES } from "./categories";
import { byGroup, monthlyTrend, trendMonths, upcomingByWeek, type MetricExpense } from "./metrics";

const zero = { grossCents: 0, refundsCents: 0, netCents: 0 };

describe("buildSummaryCards (GF25)", () => {
  it("ingresos 12.400 y gastos 3.150: resultado USD 9.250,00 y margen 74,6 %", () => {
    const cards = buildSummaryCards(buildSummaryMetrics({ revenue: { grossCents: 1240000, refundsCents: 0, netCents: 1240000 }, expensesCents: 315000 }));
    expect(cards.map((c) => c.key)).toEqual(["revenue", "expenses", "result", "margin"]);
    expect(cards[0].value).toBe("USD 12.400,00");
    expect(cards[1].value).toBe("USD 3.150,00");
    expect(cards[2].value).toBe("USD 9.250,00");
    expect(cards[2].tone).toBe("positive");
    expect(cards[3].value).toBe("74,6 %");
  });

  it("ingresos con el bruto y los reembolsos debajo", () => {
    const [revenue] = buildSummaryCards(buildSummaryMetrics({ revenue: { grossCents: 100000, refundsCents: -20000, netCents: 80000 }, expensesCents: 0 }));
    expect(revenue.value).toBe("USD 800,00");
    expect(revenue.detail).toBe("bruto USD 1.000,00 · reembolsos −USD 200,00");
    const [none] = buildSummaryCards(buildSummaryMetrics({ revenue: { grossCents: 5000, refundsCents: 0, netCents: 5000 }, expensesCents: 0 }));
    expect(none.detail).toBe("bruto USD 50,00 · reembolsos USD 0,00");
  });

  it("gastos que suben 20 % => flecha roja; ingresos que suben => verde", () => {
    const cards = buildSummaryCards(buildSummaryMetrics({ revenue: { grossCents: 120000, refundsCents: 0, netCents: 120000 }, expensesCents: 120000, previous: { revenueCents: 100000, expensesCents: 100000 } }));
    expect(cards[0].variation).toEqual({ kind: "change", arrow: "up", tone: "good", text: "+20,0 %" });
    expect(cards[1].variation).toEqual({ kind: "change", arrow: "up", tone: "bad", text: "+20,0 %" });
  });

  it("gastos que bajan => verde; ingresos que bajan => rojo", () => {
    const cards = buildSummaryCards(buildSummaryMetrics({ revenue: { grossCents: 90000, refundsCents: 0, netCents: 90000 }, expensesCents: 80000, previous: { revenueCents: 100000, expensesCents: 100000 } }));
    expect(cards[0].variation).toMatchObject({ arrow: "down", tone: "bad", text: "−10,0 %" });
    expect(cards[1].variation).toMatchObject({ arrow: "down", tone: "good", text: "−20,0 %" });
  });

  it("período Histórico: ninguna tarjeta muestra variación, aunque venga un anterior", () => {
    const m = buildSummaryMetrics({ revenue: { grossCents: 100, refundsCents: 0, netCents: 100 }, expensesCents: 50, previous: { revenueCents: 10, expensesCents: 5 }, preset: "historico" });
    expect(buildSummaryCards(m).every((c) => c.variation.kind === "none")).toBe(true);
    // Sin anterior (el loader no lo manda) tampoco.
    expect(buildSummaryCards(buildSummaryMetrics({ revenue: zero, expensesCents: 0 })).every((c) => c.variation.kind === "none")).toBe(true);
  });

  it("anterior en 0 => 'sin comparación'", () => {
    const cards = buildSummaryCards(buildSummaryMetrics({ revenue: { grossCents: 100, refundsCents: 0, netCents: 100 }, expensesCents: 50, previous: { revenueCents: 0, expensesCents: 0 } }));
    expect(cards[0].variation).toEqual({ kind: "unavailable", text: "sin comparación" });
    expect(cards[1].variation).toEqual({ kind: "unavailable", text: "sin comparación" });
    // El margen anterior no existe (ingreso 0): tampoco hay comparación.
    expect(cards[3].variation.kind).toBe("unavailable");
  });

  it("ingresos 0: margen '—'; resultado negativo en rojo", () => {
    const cards = buildSummaryCards(buildSummaryMetrics({ revenue: zero, expensesCents: 5000 }));
    expect(cards[3].value).toBe("—");
    expect(cards[3].tone).toBe("neutral");
    expect(cards[2].value).toBe("−USD 50,00");
    expect(cards[2].tone).toBe("negative");
  });

  it("el margen se compara en puntos, no en %", () => {
    const cards = buildSummaryCards(buildSummaryMetrics({ revenue: { grossCents: 100000, refundsCents: 0, netCents: 100000 }, expensesCents: 20000, previous: { revenueCents: 100000, expensesCents: 30000 } }));
    expect(cards[3].value).toBe("80,0 %");
    expect(cards[3].variation).toEqual({ kind: "change", arrow: "up", tone: "good", text: "+10,0 pp" });
  });

  it("una variación en 0 es plana y neutra", () => {
    const cards = buildSummaryCards(buildSummaryMetrics({ revenue: { grossCents: 100, refundsCents: 0, netCents: 100 }, expensesCents: 0, previous: { revenueCents: 100, expensesCents: 0 } }));
    expect(cards[0].variation).toEqual({ kind: "change", arrow: "flat", tone: "neutral", text: "0,0 %" });
    expect(formatSignedPct(-5)).toBe("−5,0 %");
  });
});

describe("buildDrilldownHref (GF26)", () => {
  const now = new Date("2026-10-10T18:00:00Z");
  const period = resolvePeriod("este-mes", now, "America/Costa_Rica");

  it("categoría: pagados, rango por fecha de pago del período y esa categoría", () => {
    const href = buildDrilldownHref({ categoryKey: "ads_meta", period, timeZone: "America/Costa_Rica" });
    expect(href.startsWith("/dashboard/finanzas/gastos?")).toBe(true);
    const f = parseExpenseFilters(new URLSearchParams(href.split("?")[1]));
    expect(f).toMatchObject({ statuses: ["pagado"], dateField: "pago", from: "2026-10-01", to: null, categories: ["ads_meta"], vendors: [] });
  });

  it("proveedor, y un período cerrado lleva el hasta", () => {
    const prev = previousPeriod(period, now);
    const href = buildDrilldownHref({ vendorId: "11111111-1111-4111-8111-111111111111", period: prev, timeZone: "America/Costa_Rica" });
    const f = parseExpenseFilters(new URLSearchParams(href.split("?")[1]));
    expect(f.vendors).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(f.statuses).toEqual(["pagado"]);
    expect(f.dateField).toBe("pago");
    expect(f.from).not.toBeNull();
    expect(f.to).toBe("2026-09-30");
  });

  it("histórico: sin rango, pero igual pagados por fecha de pago", () => {
    const f = parseExpenseFilters(new URLSearchParams(buildDrilldownHref({ categoryKey: "software", period: { from: null, to: null }, timeZone: "UTC" }).split("?")[1]));
    expect(f).toMatchObject({ from: null, to: null, statuses: ["pagado"], dateField: "pago" });
  });

  it("un grupo", () => {
    const f = parseExpenseFilters(new URLSearchParams(buildDrilldownHref({ group: "adquisicion", period, timeZone: "UTC" }).split("?")[1]));
    expect(f.group).toBe("adquisicion");
  });
});

describe("buildGroupBars (GF26)", () => {
  it("Adquisición lleva la nota 'Lo que cuesta conseguir clientes'", () => {
    const bars = buildGroupBars(byGroup([{ status: "pagado", amount: 58, category_key: "ads_meta" }, { status: "pagado", amount: 42, category_key: "software" }], DEFAULT_EXPENSE_CATEGORIES));
    expect(bars).toHaveLength(4);
    expect(bars[0]).toMatchObject({ key: "adquisicion", pct: 58 });
    expect(bars[0].hint).toMatch(/cuesta conseguir clientes/);
    expect(bars.slice(1).every((b) => b.hint === null)).toBe(true);
  });
});

describe("buildTrendSeries (GF27)", () => {
  const months = trendMonths("2026-10-15");
  const trend = monthlyTrend(
    [{ type: "installment", status: "paid", amount: 1000, paid_at: "2026-10-02T12:00:00Z" }],
    [{ status: "pagado", amount: 250.5, paid_date: "2026-10-03" }],
    months,
    "UTC",
  );
  const chart = buildTrendSeries(trend);

  it("barras Ingresos y Gastos, línea Resultado, en dólares", () => {
    expect(chart.bars.map((s) => s.label)).toEqual(["Ingresos", "Gastos"]);
    expect(chart.lines.map((s) => s.label)).toEqual(["Resultado"]);
    const lastRevenue = chart.bars[0].points[5];
    expect(lastRevenue).toEqual({ bucket: "2026-10", value: 1000 });
    expect(chart.bars[1].points[5].value).toBe(250.5);
    expect(chart.lines[0].points[5].value).toBe(749.5);
  });

  it("los 6 meses están y los meses sin datos valen 0 (nunca null)", () => {
    for (const s of [...chart.bars, ...chart.lines]) {
      expect(s.points).toHaveLength(6);
      expect(s.points.every((p) => typeof p.value === "number")).toBe(true);
    }
    expect(chart.bars[0].points[2]).toEqual({ bucket: "2026-07", value: 0 });
  });

  it("el mes en curso va marcado", () => {
    expect(chart.currentBucket).toBe("2026-10");
    expect(chart.markers).toEqual([{ bucket: "2026-10", label: expect.stringMatching(/en curso/), color: expect.any(String) }]);
    expect(chart.formatBucket("2026-10")).toBe("oct · en curso");
    expect(chart.formatBucket("2026-05")).toBe("may");
  });

  it("sin movimiento en los 6 meses: isEmpty; con datos no", () => {
    expect(chart.isEmpty).toBe(false);
    expect(buildTrendSeries(monthlyTrend([], [], months, "UTC")).isEmpty).toBe(true);
    expect(buildTrendSeries([])).toMatchObject({ currentBucket: null, markers: [], isEmpty: true });
  });

  it("es compatible con las props de DualAxisChart (tipos)", () => {
    const bars: ChartSeries[] = chart.bars;
    const lines: ChartSeries[] = chart.lines;
    const legend: ChartSeries[] = chart.legend;
    expect(bars.length + lines.length).toBe(3);
    expect(legend).toHaveLength(3);
  });
});

describe("buildCacCard (GF27)", () => {
  it("USD 1.500 en Adquisición y 4 ventas nuevas: USD 375,00 por venta", () => {
    const c = buildCacCard({ acquisitionCents: 150000, newSalesCount: 4 });
    expect(c.value).toBe("USD 375,00");
    expect(c.headline).toBe("Costo de adquisición: USD 375,00 por venta nueva");
    expect(c.cents).toBe(37500);
    expect(c.how).toBe("Gastos pagados de Adquisición (USD 1.500,00) ÷ ventas nuevas del período (4)");
  });

  it("sin ventas nuevas", () => {
    const c = buildCacCard({ acquisitionCents: 150000, newSalesCount: 0 });
    expect(c.value).toBeNull();
    expect(c.headline).toBe("Sin ventas nuevas en el período");
    expect(c.cents).toBeNull();
  });
});

describe("buildUpcomingRows (GF28)", () => {
  const today = "2026-10-14"; // miércoles
  const e = (over: Partial<MetricExpense>): MetricExpense => ({ status: "programado", amount: 10, scheduled_date: "2026-10-15", ...over });

  it("un vencido y dos programados en semanas distintas: tres filas con sus montos", () => {
    const rows = buildUpcomingRows(
      upcomingByWeek([e({ status: "vencido", amount: 40, scheduled_date: "2026-10-01" }), e({ amount: 10, scheduled_date: "2026-10-15" }), e({ amount: 20.5, scheduled_date: "2026-10-22" })], today),
      today,
    );
    expect(rows.map((r) => r.kind)).toEqual(["overdue", "week", "week"]);
    expect(rows[0]).toMatchObject({ label: "Vencidos", tone: "red", countText: "1 pago", amountText: "USD 40,00" });
    expect(rows[1]).toMatchObject({ label: "Esta semana · 12–18 oct", amountText: "USD 10,00", tone: "neutral" });
    expect(rows[2]).toMatchObject({ label: "19–25 oct", amountText: "USD 20,50" });
  });

  it("'Por revisar: N sin monto' va abajo y sin monto", () => {
    const rows = buildUpcomingRows(upcomingByWeek([e({ amount: 10 }), e({ status: "por_revisar", amount: 0 }), e({ status: "por_revisar", amount: 0 })], today), today);
    expect(rows[rows.length - 1]).toMatchObject({ kind: "review", label: "Por revisar: 2 sin monto", amountText: null, tone: "amber" });
    expect(rows[0].kind).toBe("week");
  });

  it("los links llevan a la lista filtrada y la semana se recorta a la ventana de 30 días", () => {
    const rows = buildUpcomingRows(upcomingByWeek([e({ status: "vencido", scheduled_date: "2026-10-01" }), e({ scheduled_date: "2026-10-15" }), e({ scheduled_date: "2026-11-13" }), e({ status: "por_revisar" })], today), today);
    const [overdue, thisWeek, lastWeek, review] = rows.map((r) => parseExpenseFilters(new URLSearchParams(r.href.split("?")[1])));
    expect(overdue.pill).toBe("vencidos");
    expect(thisWeek).toMatchObject({ statuses: ["programado"], from: "2026-10-14", to: "2026-10-18" });
    expect(lastWeek).toMatchObject({ statuses: ["programado"], from: "2026-11-09", to: "2026-11-13" });
    expect(review.pill).toBe("por_revisar");
  });

  it("nada por pagar => ninguna fila; pluraliza", () => {
    expect(buildUpcomingRows(upcomingByWeek([], today), today)).toEqual([]);
    const rows = buildUpcomingRows(upcomingByWeek([e({}), e({})], today), today);
    expect(rows[0].countText).toBe("2 pagos");
  });

  it("la etiqueta de una semana que cruza de mes", () => {
    expect(weekRangeLabel("2026-10-26", "2026-11-01")).toBe("26 oct – 1 nov");
    expect(weekRangeLabel("2026-10-12", "2026-10-18")).toBe("12–18 oct");
  });
});
