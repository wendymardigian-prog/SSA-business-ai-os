/**
 * Las métricas del panel de Finanzas (GF23). Puras: reciben filas y devuelven números.
 *
 * REGLA: todo va en CÉNTIMOS enteros y vuelve en céntimos; la pantalla formatea (`formatUsd`). Nada de
 * flotantes en una suma (una comisión de 416,67 + 416,67 + 416,66 tiene que dar 1.250,00 exacto).
 *
 * Qué suma y qué no:
 *  - Ingresos: SOLO pagos `paid`. Un reembolso es una fila `type = 'refund'`, `paid` y de monto NEGATIVO:
 *    resta sola, una vez. Programado, vencido, incobrable o cancelado no suman (tampoco un reembolso cancelado).
 *  - Gastos: SOLO `pagado` (los ajustes con su signo). Anulado y por revisar NUNCA suman: por eso cada función
 *    de gastos vuelve a filtrar por estado aunque quien llama ya lo haya hecho (la suma de los grupos tiene
 *    que ser igual a la tarjeta de gastos pagados).
 *  - Las categorías se identifican por su `key` (las categorías viven en `workspaces.finance_settings`, no en una tabla).
 */
import { toCents } from "@/lib/sales/money";
import { CATEGORY_GROUPS, CATEGORY_GROUP_LABELS, type CategoryGroup, type ExpenseCategory } from "./categories";
import { addDays, localDate, monthKey, previousMonthKey, weekEnd, weekStart, type CivilDate } from "./dates";
import type { VendorLite } from "./vendors";

export { toCents, fromCents } from "@/lib/sales/money";

// ---------------------------------------------------------------------------------------------------------
// Entradas

/** Un pago de Ventas (solo las columnas que usa el panel). */
export interface MetricPayment {
  type: string;
  status: string;
  amount: unknown;
  paid_at: string | null;
}

/** Un gasto (solo las columnas que usa el panel). */
export interface MetricExpense {
  status: string;
  amount: unknown;
  category_key?: string | null;
  vendor_id?: string | null;
  paid_date?: string | null;
  scheduled_date?: string | null;
}

// ---------------------------------------------------------------------------------------------------------
// Ingresos y gastos

export interface CashRevenue {
  /** Lo cobrado sin contar reembolsos. */
  grossCents: number;
  /** Los reembolsos, en negativo (o 0). */
  refundsCents: number;
  /** bruto + reembolsos: lo que de verdad entró. */
  netCents: number;
}

export function cashRevenue(payments: readonly MetricPayment[]): CashRevenue {
  let grossCents = 0;
  let refundsCents = 0;
  for (const p of payments) {
    if (p.status !== "paid") continue;
    const cents = toCents(p.amount);
    if (p.type === "refund") refundsCents += cents;
    else grossCents += cents;
  }
  return { grossCents, refundsCents, netCents: grossCents + refundsCents };
}

/** Solo los pagados (anulado y por revisar nunca suman). */
function onlyPaid<T extends { status: string }>(expenses: readonly T[]): T[] {
  return expenses.filter((e) => e.status === "pagado");
}

/** Suma de los gastos `pagado`; un ajuste negativo resta. */
export function paidExpenses(expenses: readonly Pick<MetricExpense, "status" | "amount">[]): number {
  let total = 0;
  for (const e of onlyPaid(expenses)) total += toCents(e.amount);
  return total;
}

/** Ingreso neto − gastos pagados. */
export function result(revenueCents: number, expensesCents: number): number {
  return revenueCents - expensesCents;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Margen en % con un decimal. Sin ingreso (0, o neto negativo por reembolsos) no hay margen que calcular:
 * `null` y la pantalla muestra "—", nunca "0 %".
 */
export function marginPct(resultCents: number, revenueCents: number): number | null {
  if (!Number.isFinite(revenueCents) || revenueCents <= 0) return null;
  return round1((resultCents / revenueCents) * 100);
}

/**
 * Variación contra el período anterior, en % con un decimal. `null` si el anterior es 0 (no hay contra qué
 * comparar). Con un anterior negativo se divide por su valor absoluto: pasar de −100 a +50 es una suba.
 */
export function deltaPct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return round1(((current - previous) / Math.abs(previous)) * 100);
}

// ---------------------------------------------------------------------------------------------------------
// Porcentajes que suman exactamente 100,0

/**
 * Porcentajes con un decimal que suman EXACTAMENTE 100,0: se redondea cada uno en décimas enteras y la
 * diferencia la absorbe el mayor. Con un total <= 0 no hay reparto (todo en 0).
 */
export function allocatePct(values: readonly number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return values.map(() => 0);
  const tenths = values.map((v) => Math.round((v * 1000) / total));
  const diff = 1000 - tenths.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    let biggest = 0;
    values.forEach((v, i) => {
      if (v > values[biggest]) biggest = i;
    });
    tenths[biggest] += diff;
  }
  return tenths.map((t) => t / 10);
}

// ---------------------------------------------------------------------------------------------------------
// Por categoría y por grupo

export interface CategoryTotal {
  categoryKey: string;
  name: string;
  color: string;
  group: CategoryGroup;
  cents: number;
  count: number;
  pct: number;
}

const UNKNOWN_COLOR = "#78716c";

/** Gasto pagado por categoría, de mayor a menor. Las categorías sin gasto no aparecen. Los pct suman 100,0. */
export function byCategory(expenses: readonly MetricExpense[], categories: readonly ExpenseCategory[]): CategoryTotal[] {
  const acc = new Map<string, { cents: number; count: number }>();
  for (const e of onlyPaid(expenses)) {
    const key = e.category_key ?? "__sin_categoria__";
    const slot = acc.get(key) ?? { cents: 0, count: 0 };
    slot.cents += toCents(e.amount);
    slot.count += 1;
    acc.set(key, slot);
  }
  const rows = [...acc.entries()]
    .filter(([, v]) => v.cents !== 0)
    .map(([key, v]) => {
      const cat = categories.find((c) => c.key === key);
      return {
        categoryKey: key,
        name: cat ? cat.name : key === "__sin_categoria__" ? "Sin categoría" : key,
        color: cat?.color ?? UNKNOWN_COLOR,
        group: (cat?.group ?? "otro") as CategoryGroup,
        cents: v.cents,
        count: v.count,
      };
    })
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
  const pcts = allocatePct(rows.map((r) => r.cents));
  return rows.map((r, i) => ({ ...r, pct: pcts[i] }));
}

export interface GroupTotal {
  group: CategoryGroup;
  label: string;
  cents: number;
  count: number;
  pct: number;
}

/** Los 4 grupos siempre, en el orden fijo del catálogo (en 0 si no hay gasto). El grupo se lee de la categoría. */
export function byGroup(expenses: readonly MetricExpense[], categories: readonly ExpenseCategory[]): GroupTotal[] {
  const acc = new Map<CategoryGroup, { cents: number; count: number }>(CATEGORY_GROUPS.map((g) => [g, { cents: 0, count: 0 }]));
  for (const e of onlyPaid(expenses)) {
    const group = (categories.find((c) => c.key === e.category_key)?.group ?? "otro") as CategoryGroup;
    const slot = acc.get(group)!;
    slot.cents += toCents(e.amount);
    slot.count += 1;
  }
  const cents = CATEGORY_GROUPS.map((g) => acc.get(g)!.cents);
  const pcts = allocatePct(cents);
  return CATEGORY_GROUPS.map((group, i) => ({ group, label: CATEGORY_GROUP_LABELS[group], cents: cents[i], count: acc.get(group)!.count, pct: pcts[i] }));
}

// ---------------------------------------------------------------------------------------------------------
// Proveedores

export interface VendorTotal {
  vendorId: string;
  name: string;
  count: number;
  cents: number;
  /** % del gasto pagado total, un decimal (no suman 100: es un top). */
  pct: number;
}

export interface TopVendors {
  top: VendorTotal[];
  /** Gasto pagado sin proveedor: aparte, no compite en el top. */
  withoutVendor: { count: number; cents: number; pct: number };
  /** El gasto pagado total (con y sin proveedor): el 100 % de los pct. */
  totalCents: number;
}

export function topVendors(expenses: readonly MetricExpense[], vendors: readonly VendorLite[], n = 10): TopVendors {
  const acc = new Map<string, { cents: number; count: number }>();
  const none = { cents: 0, count: 0 };
  let totalCents = 0;
  for (const e of onlyPaid(expenses)) {
    const cents = toCents(e.amount);
    totalCents += cents;
    if (!e.vendor_id) {
      none.cents += cents;
      none.count += 1;
      continue;
    }
    const slot = acc.get(e.vendor_id) ?? { cents: 0, count: 0 };
    slot.cents += cents;
    slot.count += 1;
    acc.set(e.vendor_id, slot);
  }
  const pct = (cents: number) => (totalCents > 0 ? round1((cents / totalCents) * 100) : 0);
  const top = [...acc.entries()]
    .map(([vendorId, v]) => {
      const vendor = vendors.find((x) => x.id === vendorId);
      const name = vendor ? (vendor.archived_at ? `${vendor.name} (archivado)` : vendor.name) : "Proveedor desconocido";
      return { vendorId, name, count: v.count, cents: v.cents, pct: pct(v.cents) };
    })
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, n));
  return { top, withoutVendor: { count: none.count, cents: none.cents, pct: pct(none.cents) }, totalCents };
}

// ---------------------------------------------------------------------------------------------------------
// Tendencia mensual

/** Las claves `AAAA-MM` de los `count` meses terminando en el mes de `todayLocal` (en orden cronológico). */
export function trendMonths(todayLocal: CivilDate, count = 6): string[] {
  const out: string[] = [];
  let key = monthKey(todayLocal);
  for (let i = 0; i < count; i++) {
    out.unshift(key);
    key = previousMonthKey(key);
  }
  return out;
}

export interface MonthPoint {
  /** `AAAA-MM`, mes calendario en la zona del workspace. */
  month: string;
  revenueCents: number;
  expensesCents: number;
  resultCents: number;
}

/**
 * Ingresos netos y gastos pagados por mes calendario LOCAL. Un mes sin datos está en 0 (no ausente: un mes
 * sin gastos es un mes sin gastos). El mes de un pago sale de `paid_at` en la zona `tz`; el de un gasto, de
 * su `paid_date` (fecha civil). Lo que cae fuera de `months` se ignora.
 */
export function monthlyTrend(
  payments: readonly MetricPayment[],
  expenses: readonly Pick<MetricExpense, "status" | "amount" | "paid_date">[],
  months: readonly string[],
  tz: string,
): MonthPoint[] {
  const revenue = new Map<string, number>(months.map((m) => [m, 0]));
  const spent = new Map<string, number>(months.map((m) => [m, 0]));
  for (const p of payments) {
    if (p.status !== "paid" || !p.paid_at) continue;
    const key = monthKey(localDate(p.paid_at, tz));
    if (revenue.has(key)) revenue.set(key, revenue.get(key)! + toCents(p.amount));
  }
  for (const e of onlyPaid(expenses)) {
    if (!e.paid_date) continue;
    const key = monthKey(e.paid_date);
    if (spent.has(key)) spent.set(key, spent.get(key)! + toCents(e.amount));
  }
  return months.map((month) => {
    const revenueCents = revenue.get(month) ?? 0;
    const expensesCents = spent.get(month) ?? 0;
    return { month, revenueCents, expensesCents, resultCents: revenueCents - expensesCents };
  });
}

// ---------------------------------------------------------------------------------------------------------
// Costo de adquisición

/** Costo por venta nueva en céntimos (redondeado). `null` si no hubo ventas nuevas. */
export function cac(acquisitionCents: number, newSalesCount: number): number | null {
  if (!Number.isFinite(newSalesCount) || newSalesCount <= 0) return null;
  return Math.round(acquisitionCents / newSalesCount);
}

// ---------------------------------------------------------------------------------------------------------
// Por pagar

export const UPCOMING_DAYS = 30;

export interface UpcomingWeek {
  /** Lunes de la semana. */
  weekStart: CivilDate;
  /** Domingo de la semana. */
  weekEnd: CivilDate;
  count: number;
  cents: number;
}

export interface Upcoming {
  /** Ventana consultada: de hoy a hoy + 30 días (inclusive). */
  from: CivilDate;
  to: CivilDate;
  /** Vencidos (cualquier fecha pasada), en su balde aparte. */
  overdue: { count: number; cents: number };
  /** Una entrada por semana CON gastos, de la más próxima a la más lejana. */
  weeks: UpcomingWeek[];
  /** Por revisar: se cuentan aparte, no tienen monto. */
  toReview: { count: number };
}

/**
 * Lo que hay por pagar en los próximos 30 días. Programados con fecha en `[hoy, hoy + 30]` agrupados por
 * semana (lunes a domingo); un programado a 31 días no entra. Un `programado` con fecha ya pasada (el
 * trabajo de vencimiento todavía no corrió) cuenta como vencido para no esconder plata.
 */
export function upcomingByWeek(expenses: readonly MetricExpense[], todayLocal: CivilDate): Upcoming {
  const to = addDays(todayLocal, UPCOMING_DAYS);
  const overdue = { count: 0, cents: 0 };
  const toReview = { count: 0 };
  const weeks = new Map<CivilDate, UpcomingWeek>();
  for (const e of expenses) {
    if (e.status === "por_revisar") {
      toReview.count += 1;
      continue;
    }
    const date = e.scheduled_date ?? null;
    const isOverdue = e.status === "vencido" || (e.status === "programado" && date !== null && date < todayLocal);
    if (isOverdue) {
      overdue.count += 1;
      overdue.cents += toCents(e.amount);
      continue;
    }
    if (e.status !== "programado" || !date || date < todayLocal || date > to) continue;
    const start = weekStart(date);
    const week = weeks.get(start) ?? { weekStart: start, weekEnd: weekEnd(date), count: 0, cents: 0 };
    week.count += 1;
    week.cents += toCents(e.amount);
    weeks.set(start, week);
  }
  return { from: todayLocal, to, overdue, weeks: [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart)), toReview };
}

// La de la lista de gastos (GF12): se re-exporta para que el panel importe todo de un solo lugar.
export { totalsByStatus } from "./expense-list";
