/**
 * Lo que necesita el Resumen de Finanzas (SOLO servidor): lee, suma en céntimos con `metrics.ts` y devuelve
 * AGREGADOS ya calculados. Ninguna fila de pagos ni de ventas viaja al navegador (un test mira la forma del
 * resultado).
 *
 * Quién lee qué: los pagos y las ventas, con el cliente de servicio filtrado por el workspace de la SESIÓN y
 * DESPUÉS de `requirePermission("expenses.view")` (ver Finanzas no da acceso a las ventas una por una, solo a
 * sus totales); los gastos, con la sesión (la RLS de `expenses.view` decide).
 *
 * El período sale de los atajos de `lib/dashboards/period.ts`, cortados en la zona del WORKSPACE (la contabilidad
 * no puede cambiar según quién mira). El anterior es de igual duración, inmediatamente antes; Histórico no tiene.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { startOfDay } from "@/lib/dates";
import { parsePeriodFilter } from "@/lib/agent/ai-dashboard/url-state";
import { PERIOD_LABELS, previousPeriod, resolvePeriod, type ResolvedPeriod } from "@/lib/dashboards/period";
import { formatRange, isoRangeToCivil } from "@/lib/dashboards/chat/date-range";
import type { Database } from "@/lib/types/database";
import type { CategoryGroup, ExpenseCategory } from "./categories";
import { financeContextOf } from "./context";
import { addDays, monthEnd, monthStart } from "./dates";
import {
  buildCacCard, buildDrilldownHref, buildGroupBars, buildSummaryCards, buildSummaryMetrics, buildUpcomingRows, civilRange,
  type CacCard, type GroupBar, type SummaryCard, type UpcomingRow,
} from "./dashboard-view";
import {
  byCategory, byGroup, cashRevenue, monthlyTrend, paidExpenses, topVendors, trendMonths, upcomingByWeek, UPCOMING_DAYS,
  type CategoryTotal, type MetricExpense, type MetricPayment, type MonthPoint, type VendorTotal,
} from "./metrics";
import type { VendorLite } from "./vendors";

type Db = SupabaseClient<Database>;

/** Tope de filas por consulta: más allá, el panel avisa que muestra parcial en vez de callarlo. */
export const DASHBOARD_ROW_LIMIT = 20000;

export interface FinanceDashboardData {
  timeZone: string;
  todayLocal: string;
  preset: string;
  periodLabel: string;
  /** El mes en curso (`AAAA-MM`), para marcar la tendencia. */
  currentMonth: string;
  loadError: boolean;
  /** Alguna consulta llegó al tope: las cifras son parciales. */
  truncated: boolean;
  cards: SummaryCard[];
  /** Hubo al menos un pago cobrado en el período (si no, el panel lo dice en vez de mostrar ceros mudos). */
  hasRevenue: boolean;
  expensesCents: number;
  hasExpenses: boolean;
  groups: Array<GroupBar & { href: string }>;
  categories: Array<CategoryTotal & { href: string }>;
  vendors: { top: Array<VendorTotal & { href: string }>; withoutVendor: { count: number; cents: number; pct: number }; totalCents: number };
  trend: MonthPoint[];
  cac: CacCard;
  upcoming: UpcomingRow[];
  canManage: boolean;
}

/** El período por defecto de Finanzas (los demás dashboards usan 30 días). */
export const FINANCE_DEFAULT_PERIOD = "este-mes" as const;

/** Los parámetros de la URL que cuentan: `range`, `from` y `to`. Sin ninguno, "Este mes". */
export function financePeriodParams(searchParams: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string") params.set(k, v);
  if (!params.get("range") && !(params.get("from") && params.get("to"))) params.set("range", FINANCE_DEFAULT_PERIOD);
  return params;
}

async function readPayments(service: Db, workspaceId: string, from: string | null, to: string | null) {
  let query = service.from("payments").select("type, status, amount, paid_at").eq("workspace_id", workspaceId).eq("status", "paid");
  if (from) query = query.gte("paid_at", from);
  if (to) query = query.lte("paid_at", to);
  const { data, error } = await query.limit(DASHBOARD_ROW_LIMIT);
  if (error) throw new Error(`pagos: ${error.message}`);
  return (data ?? []) as unknown as MetricPayment[];
}

async function readPaidExpenses(db: Db, workspaceId: string, from: string | null, to: string | null) {
  let query = db.from("expenses").select("status, amount, category_key, vendor_id, paid_date").eq("workspace_id", workspaceId).eq("status", "pagado");
  if (from) query = query.gte("paid_date", from);
  if (to) query = query.lte("paid_date", to);
  const { data, error } = await query.limit(DASHBOARD_ROW_LIMIT);
  if (error) throw new Error(`gastos: ${error.message}`);
  return (data ?? []) as unknown as MetricExpense[];
}

export async function loadFinanceDashboard(ctx: PermissionContext, searchParams: Record<string, string | string[] | undefined>, now: Date = new Date()): Promise<FinanceDashboardData> {
  const f = financeContextOf(ctx, now);
  const tz = f.tz;
  const categories: ExpenseCategory[] = f.settings.expense_categories;
  const filter = parsePeriodFilter(financePeriodParams(searchParams));
  const custom = filter.from && filter.to;
  const range: ResolvedPeriod = custom ? { from: filter.from, to: filter.to } : resolvePeriod(filter.period, now, tz);
  const preset = custom ? "personalizado" : filter.period;
  const periodLabel = custom ? formatRange(isoRangeToCivil(filter.from!, filter.to!, tz)) : PERIOD_LABELS[filter.period];
  const compare = preset !== "historico" && range.from ? previousPeriod(range, now) : null;
  const civil = civilRange(range, tz);
  const civilPrev = compare ? civilRange(compare, tz) : null;
  // Un período abierto arriba llega hasta hoy.
  const expenseTo = civil.to ?? f.todayLocal;
  const months = trendMonths(f.todayLocal, 6);
  const trendFromInstant = startOfDayIso(monthStart(months[0]), tz);
  const trendFromCivil = monthStart(months[0]);
  const horizon = addDays(f.todayLocal, UPCOMING_DAYS);

  const base: FinanceDashboardData = {
    timeZone: tz, todayLocal: f.todayLocal, preset, periodLabel, currentMonth: months[months.length - 1],
    loadError: false, truncated: false,
    cards: buildSummaryCards(buildSummaryMetrics({ revenue: cashRevenue([]), expensesCents: 0, preset })),
    hasRevenue: false, expensesCents: 0, hasExpenses: false,
    groups: [], categories: [], vendors: { top: [], withoutVendor: { count: 0, cents: 0, pct: 0 }, totalCents: 0 },
    trend: monthlyTrend([], [], months, tz), cac: buildCacCard({ acquisitionCents: 0, newSalesCount: 0 }), upcoming: [],
    canManage: ctx.can("expenses.manage"),
  };

  try {
    const service = (await createServiceClient()) as Db;
    const session = ctx.supabase as unknown as Db;
    const ws = ctx.workspace.id;

    const [payments, prevPayments, expenses, prevExpenses, trendPayments, trendExpenses, salesCount, vendorsRes, overdueRes, scheduledRes] = await Promise.all([
      readPayments(service, ws, range.from, range.to),
      compare ? readPayments(service, ws, compare.from, compare.to) : Promise.resolve([] as MetricPayment[]),
      readPaidExpenses(session, ws, civil.from, expenseTo),
      civilPrev ? readPaidExpenses(session, ws, civilPrev.from, civilPrev.to) : Promise.resolve([] as MetricExpense[]),
      readPayments(service, ws, trendFromInstant, null),
      readPaidExpenses(session, ws, trendFromCivil, monthEnd(months[months.length - 1])),
      (async () => {
        let q = service.from("sales").select("id", { count: "exact", head: true }).eq("workspace_id", ws).neq("status", "cancelled");
        if (civil.from) q = q.gte("sale_date", civil.from);
        q = q.lte("sale_date", expenseTo);
        const { count, error } = await q;
        if (error) throw new Error(`ventas: ${error.message}`);
        return count ?? 0;
      })(),
      session.from("vendors").select("id, name, archived_at, user_id").eq("workspace_id", ws).limit(5000),
      session.from("expenses").select("status, amount, scheduled_date").eq("workspace_id", ws).in("status", ["vencido", "por_revisar"]).limit(2000),
      session.from("expenses").select("status, amount, scheduled_date").eq("workspace_id", ws).eq("status", "programado").lte("scheduled_date", horizon).limit(2000),
    ]);
    if (vendorsRes.error || overdueRes.error || scheduledRes.error) throw new Error("apoyo");

    const truncated = [payments, prevPayments, expenses, prevExpenses, trendPayments, trendExpenses].some((rows) => rows.length >= DASHBOARD_ROW_LIMIT);
    const revenue = cashRevenue(payments);
    const expensesCents = paidExpenses(expenses);
    const metrics = buildSummaryMetrics({
      revenue, expensesCents, preset,
      previous: compare ? { revenueCents: cashRevenue(prevPayments).netCents, expensesCents: paidExpenses(prevExpenses) } : null,
    });

    const groupTotals = byGroup(expenses, categories);
    const categoryTotals = byCategory(expenses, categories);
    const vendorTotals = topVendors(expenses, (vendorsRes.data ?? []) as unknown as VendorLite[], 10);
    const acquisitionCents = groupTotals.find((g) => g.group === "adquisicion")?.cents ?? 0;
    const upcoming = upcomingByWeek([...((overdueRes.data ?? []) as unknown as MetricExpense[]), ...((scheduledRes.data ?? []) as unknown as MetricExpense[])], f.todayLocal);
    const href = (extra: { categoryKey?: string; vendorId?: string; group?: CategoryGroup }) => buildDrilldownHref({ ...extra, period: { from: range.from, to: range.to ?? null }, timeZone: tz });

    return {
      ...base,
      truncated,
      cards: buildSummaryCards(metrics),
      hasRevenue: payments.length > 0,
      expensesCents,
      hasExpenses: expenses.length > 0,
      groups: buildGroupBars(groupTotals).map((g) => ({ ...g, href: href({ group: g.key }) })),
      categories: categoryTotals.map((c) => ({ ...c, href: href({ categoryKey: c.categoryKey }) })),
      vendors: { top: vendorTotals.top.map((v) => ({ ...v, href: href({ vendorId: v.vendorId }) })), withoutVendor: vendorTotals.withoutVendor, totalCents: vendorTotals.totalCents },
      trend: monthlyTrend(trendPayments, trendExpenses, months, tz),
      cac: buildCacCard({ acquisitionCents, newSalesCount: salesCount }),
      upcoming: buildUpcomingRows(upcoming, f.todayLocal),
    };
  } catch (e) {
    console.error("[finance] no pude armar el resumen:", e instanceof Error ? e.message : String(e));
    return { ...base, loadError: true };
  }
}

function startOfDayIso(date: string, tz: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return startOfDay(y, m, d, tz).toISOString();
}
