/**
 * Lo que dibuja el panel de Finanzas (GF25 a GF28), como datos listos para pintar. Puro: los componentes
 * solo componen lo que sale de acá (texto, color, flecha, links). Todo entra y sale en céntimos; el único
 * lugar donde se convierte a dólares son las series del gráfico, que el `DualAxisChart` rotula tal cual.
 *
 * "Subir es rojo" en los gastos: el color de una variación (`good`/`bad`) NO es la dirección de la flecha.
 */
import type { ResolvedPeriod } from "@/lib/dashboards/period";
import { fromCents } from "@/lib/sales/money";
import { CATEGORY_GROUP_HINTS, type CategoryGroup } from "./categories";
import { addDays, localDate, monthKey, type CivilDate } from "./dates";
import { expensesHref } from "./expense-filters";
import { formatUsd } from "./format";
import { cac, deltaPct, marginPct, result, type CashRevenue, type GroupTotal, type MonthPoint, type Upcoming } from "./metrics";

const PCT = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** `74.6` → `74,6 %`. */
export function formatPct(value: number): string {
  return `${value < 0 ? "−" : ""}${PCT.format(Math.abs(value))} %`;
}

/** Una variación con signo explícito: `20` → `+20,0 %`, `-5` → `−5,0 %`, `0` → `0,0 %`. */
export function formatSignedPct(value: number): string {
  if (value === 0) return `${PCT.format(0)} %`;
  return `${value > 0 ? "+" : "−"}${PCT.format(Math.abs(value))} %`;
}

function formatSignedPoints(value: number): string {
  if (value === 0) return `${PCT.format(0)} pp`;
  return `${value > 0 ? "+" : "−"}${PCT.format(Math.abs(value))} pp`;
}

// ---------------------------------------------------------------------------------------------------------
// GF25 · Las 4 tarjetas

/** Los totales de un período, en céntimos (neto de reembolsos). */
export interface PeriodTotals {
  revenueCents: number;
  expensesCents: number;
  resultCents: number;
  marginPct: number | null;
}

export function periodTotals(revenueCents: number, expensesCents: number): PeriodTotals {
  return { revenueCents, expensesCents, resultCents: result(revenueCents, expensesCents), marginPct: marginPct(result(revenueCents, expensesCents), revenueCents) };
}

export interface SummaryMetrics {
  revenue: CashRevenue;
  expensesCents: number;
  resultCents: number;
  marginPct: number | null;
  /** El período anterior; `null` cuando no hay (Histórico). */
  previous: PeriodTotals | null;
  /** El atajo elegido: con `historico` ninguna tarjeta muestra variación aunque venga `previous`. */
  preset?: string | null;
}

/** Arma `SummaryMetrics` desde lo crudo (para quien carga los datos). */
export function buildSummaryMetrics(input: { revenue: CashRevenue; expensesCents: number; previous?: { revenueCents: number; expensesCents: number } | null; preset?: string | null }): SummaryMetrics {
  const totals = periodTotals(input.revenue.netCents, input.expensesCents);
  return {
    revenue: input.revenue,
    expensesCents: input.expensesCents,
    resultCents: totals.resultCents,
    marginPct: totals.marginPct,
    previous: input.previous ? periodTotals(input.previous.revenueCents, input.previous.expensesCents) : null,
    preset: input.preset ?? null,
  };
}

export type CardVariation =
  | { kind: "none" }
  | { kind: "unavailable"; text: "sin comparación" }
  | { kind: "change"; arrow: "up" | "down" | "flat"; tone: "good" | "bad" | "neutral"; text: string };

export type SummaryCardKey = "revenue" | "expenses" | "result" | "margin";

export interface SummaryCard {
  key: SummaryCardKey;
  label: string;
  /** El número grande: `USD 9.250,00` o `74,6 %` (`—` si no hay margen). */
  value: string;
  /** Color del valor. */
  tone: "positive" | "negative" | "neutral";
  /** Línea chica debajo (solo Ingresos: bruto y reembolsos). */
  detail: string | null;
  variation: CardVariation;
}

function variationOf(pct: number | null, goodWhenUp: boolean): CardVariation {
  if (pct === null) return { kind: "unavailable", text: "sin comparación" };
  const arrow = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const tone = pct === 0 ? "neutral" : (pct > 0) === goodWhenUp ? "good" : "bad";
  return { kind: "change", arrow, tone, text: formatSignedPct(pct) };
}

function marginVariation(current: number | null, previous: number | null): CardVariation {
  if (current === null || previous === null) return { kind: "unavailable", text: "sin comparación" };
  const diff = Math.round((current - previous) * 10) / 10;
  const arrow = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  return { kind: "change", arrow, tone: diff === 0 ? "neutral" : diff > 0 ? "good" : "bad", text: formatSignedPoints(diff) };
}

export function buildSummaryCards(m: SummaryMetrics): SummaryCard[] {
  const compare = m.preset !== "historico" ? m.previous : null;
  const none: CardVariation = { kind: "none" };
  const refunds = m.revenue.refundsCents === 0 ? 0 : -Math.abs(m.revenue.refundsCents);
  return [
    {
      key: "revenue",
      label: "Ingresos cobrados",
      value: formatUsd(m.revenue.netCents),
      tone: "neutral",
      detail: `bruto ${formatUsd(m.revenue.grossCents)} · reembolsos ${formatUsd(refunds)}`,
      variation: compare ? variationOf(deltaPct(m.revenue.netCents, compare.revenueCents), true) : none,
    },
    {
      key: "expenses",
      label: "Gastos pagados",
      value: formatUsd(m.expensesCents),
      tone: "neutral",
      detail: null,
      // En gastos, subir es malo: rojo.
      variation: compare ? variationOf(deltaPct(m.expensesCents, compare.expensesCents), false) : none,
    },
    {
      key: "result",
      label: "Resultado",
      value: formatUsd(m.resultCents),
      tone: m.resultCents >= 0 ? "positive" : "negative",
      detail: null,
      variation: compare ? variationOf(deltaPct(m.resultCents, compare.resultCents), true) : none,
    },
    {
      key: "margin",
      label: "Margen",
      value: m.marginPct === null ? "—" : formatPct(m.marginPct),
      tone: m.marginPct === null ? "neutral" : m.marginPct >= 0 ? "positive" : "negative",
      detail: null,
      variation: compare ? marginVariation(m.marginPct, compare.marginPct) : none,
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------
// GF26 · Clic en una barra o en un proveedor

/** El rango del período como fechas civiles (en la zona del workspace). Un extremo abierto queda en `null`. */
export function civilRange(period: ResolvedPeriod, timeZone: string): { from: CivilDate | null; to: CivilDate | null } {
  return { from: period.from ? localDate(period.from, timeZone) : null, to: period.to ? localDate(period.to, timeZone) : null };
}

/**
 * El link a la lista de gastos que muestra lo que sumó una barra: pagados, con el rango del período sobre
 * la FECHA DE PAGO y la categoría, el proveedor o el grupo elegido.
 */
export function buildDrilldownHref(args: { categoryKey?: string; vendorId?: string; group?: CategoryGroup; period: ResolvedPeriod; timeZone: string }): string {
  const range = civilRange(args.period, args.timeZone);
  return expensesHref({
    statuses: ["pagado"],
    dateField: "pago",
    from: range.from,
    to: range.to,
    categories: args.categoryKey ? [args.categoryKey] : [],
    vendors: args.vendorId ? [args.vendorId] : [],
    group: args.group ?? null,
  });
}

/** Las barras de grupo: monto, % y la nota de Adquisición. */
export interface GroupBar {
  key: CategoryGroup;
  label: string;
  cents: number;
  pct: number;
  hint: string | null;
}

export function buildGroupBars(groups: readonly GroupTotal[]): GroupBar[] {
  return groups.map((g) => ({ key: g.group, label: g.label, cents: g.cents, pct: g.pct, hint: g.group === "adquisicion" ? CATEGORY_GROUP_HINTS.adquisicion : null }));
}

// ---------------------------------------------------------------------------------------------------------
// GF27 · Tendencia de 6 meses

/** Estructuralmente igual a `ChartSeries` de `components/dashboards/charts.tsx` (un test lo comprueba). */
export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  points: Array<{ bucket: string; value: number | null }>;
}

export interface TrendMarker {
  bucket: string;
  label: string;
  color: string;
}

export interface TrendChart {
  /** Para `bars` del `DualAxisChart`: Ingresos y Gastos. */
  bars: TrendSeries[];
  /** Para `lines`: Resultado. */
  lines: TrendSeries[];
  /** Para `markers`: un punto bajo el mes en curso. */
  markers: TrendMarker[];
  /** Para `formatBucket`: `oct` (el mes en curso, `oct · en curso`). */
  formatBucket: (bucket: string) => string;
  /** Para `ChartLegend`. */
  legend: TrendSeries[];
  /** El mes marcado "en curso" (el último), o `null` si no hay meses. */
  currentBucket: string | null;
  /** Sin ningún movimiento en los 6 meses (la pantalla puede mostrar el vacío en vez de un gráfico de ceros). */
  isEmpty: boolean;
}

export const TREND_COLORS = { revenue: "#16a34a", expenses: "#e11d48", result: "#2563eb" } as const;

export function shortMonthLabel(key: string): string {
  const m = Number(key.slice(5, 7));
  return MONTHS_SHORT[m - 1] ?? key;
}

/**
 * Las series del gráfico. Los valores van en DÓLARES (el gráfico los rotula tal cual) y los meses sin datos
 * van en 0, no en `null`: acá un mes sin gastos es un mes sin gastos, no un hueco. El mes en curso es el
 * último (la tendencia siempre termina en el mes actual) o `currentMonth` si se indica.
 */
export function buildTrendSeries(trend: readonly MonthPoint[], opts: { currentMonth?: string } = {}): TrendChart {
  const current = opts.currentMonth ?? trend[trend.length - 1]?.month ?? null;
  const series = (key: string, label: string, color: string, pick: (p: MonthPoint) => number): TrendSeries => ({
    key,
    label,
    color,
    points: trend.map((p) => ({ bucket: p.month, value: fromCents(pick(p)) })),
  });
  const revenue = series("revenue", "Ingresos", TREND_COLORS.revenue, (p) => p.revenueCents);
  const expenses = series("expenses", "Gastos", TREND_COLORS.expenses, (p) => p.expensesCents);
  const resultSeries = series("result", "Resultado", TREND_COLORS.result, (p) => p.resultCents);
  return {
    bars: [revenue, expenses],
    lines: [resultSeries],
    markers: current && trend.some((p) => p.month === current) ? [{ bucket: current, label: "Mes en curso: todavía no terminó", color: "#94a3b8" }] : [],
    formatBucket: (bucket) => `${shortMonthLabel(bucket)}${bucket === current ? " · en curso" : ""}`,
    legend: [revenue, expenses, resultSeries],
    currentBucket: current,
    isEmpty: trend.every((p) => p.revenueCents === 0 && p.expensesCents === 0),
  };
}

export interface CacCard {
  title: "Costo de adquisición";
  /** `USD 375,00`, o `null` sin ventas nuevas. */
  value: string | null;
  /** La frase completa de la tarjeta. */
  headline: string;
  /** Cómo se calcula, en una línea. */
  how: string;
  cents: number | null;
}

export function buildCacCard(args: { acquisitionCents: number; newSalesCount: number }): CacCard {
  const cents = cac(args.acquisitionCents, args.newSalesCount);
  const how = `Gastos pagados de Adquisición (${formatUsd(args.acquisitionCents)}) ÷ ventas nuevas del período (${args.newSalesCount})`;
  if (cents === null) return { title: "Costo de adquisición", value: null, headline: "Sin ventas nuevas en el período", how, cents: null };
  const value = formatUsd(cents);
  return { title: "Costo de adquisición", value, headline: `Costo de adquisición: ${value} por venta nueva`, how, cents };
}

// ---------------------------------------------------------------------------------------------------------
// GF28 · Por pagar

export const UPCOMING_EMPTY_TEXT = "No hay pagos programados en los próximos 30 días";

export interface UpcomingRow {
  key: string;
  kind: "overdue" | "week" | "review";
  label: string;
  /** `2 pagos` (vacío en "Por revisar", que ya lleva la cantidad en la etiqueta). */
  countText: string;
  /** `null` en "Por revisar": no tiene monto. */
  amountText: string | null;
  tone: "red" | "neutral" | "amber";
  /** La lista de gastos filtrada con lo que suma esta fila. */
  href: string;
}

function dayShort(date: CivilDate): { day: number; month: string } {
  return { day: Number(date.slice(8, 10)), month: shortMonthLabel(date) };
}

/** `12–18 oct`, o `26 oct – 1 nov` si la semana cruza de mes. */
export function weekRangeLabel(start: CivilDate, end: CivilDate): string {
  const a = dayShort(start);
  const b = dayShort(end);
  return monthKey(start) === monthKey(end) ? `${a.day}–${b.day} ${b.month}` : `${a.day} ${a.month} – ${b.day} ${b.month}`;
}

const payments = (n: number) => `${n} ${n === 1 ? "pago" : "pagos"}`;

/**
 * Las filas de "Por pagar": Vencidos arriba (en rojo), una por semana con gastos, y "Por revisar: N sin
 * monto" abajo. Una fila sin nada no aparece. Sin ninguna fila, la pantalla muestra `UPCOMING_EMPTY_TEXT`.
 */
export function buildUpcomingRows(upcoming: Upcoming, todayLocal: CivilDate): UpcomingRow[] {
  const rows: UpcomingRow[] = [];
  if (upcoming.overdue.count > 0) {
    rows.push({ key: "overdue", kind: "overdue", label: "Vencidos", countText: payments(upcoming.overdue.count), amountText: formatUsd(upcoming.overdue.cents), tone: "red", href: expensesHref({ pill: "vencidos" }) });
  }
  const horizon = addDays(todayLocal, 30);
  for (const w of upcoming.weeks) {
    const thisWeek = todayLocal >= w.weekStart && todayLocal <= w.weekEnd;
    const range = weekRangeLabel(w.weekStart, w.weekEnd);
    rows.push({
      key: `week:${w.weekStart}`,
      kind: "week",
      label: thisWeek ? `Esta semana · ${range}` : range,
      countText: payments(w.count),
      amountText: formatUsd(w.cents),
      tone: "neutral",
      // La lista se recorta a la ventana de 30 días, igual que el número de la fila.
      href: expensesHref({ statuses: ["programado"], from: w.weekStart > todayLocal ? w.weekStart : todayLocal, to: w.weekEnd < horizon ? w.weekEnd : horizon }),
    });
  }
  if (upcoming.toReview.count > 0) {
    rows.push({ key: "review", kind: "review", label: `Por revisar: ${upcoming.toReview.count} sin monto`, countText: "", amountText: null, tone: "amber", href: expensesHref({ pill: "por_revisar" }) });
  }
  return rows;
}
