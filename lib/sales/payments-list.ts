/**
 * La pantalla de Pagos (plano F33): filtros desde la URL, pastillas, consulta, filas y totales.
 * Puro: la página arma la consulta con esto y la RLS (`can_see_sale_id`) decide qué ve cada
 * persona. Los totales se calculan en céntimos y coinciden con la suma de las filas.
 */
import { addDays, isDateOnly } from "./dates";
import { delayChip, type DelayChip } from "./delay";
import { fromCents, toCents } from "./money";
import { paymentMethodName } from "./payment-methods";
import { PAYMENT_STATUSES, paymentStatusLabel, paymentTypeLabel } from "./labels";

export const PAYMENTS_PAGE_SIZE = 50;

export const PAYMENT_PILLS = ["esta_semana", "morosos", "cobrados_mes", "incobrables"] as const;
export type PaymentPill = (typeof PAYMENT_PILLS)[number];

export const PAYMENT_PILL_LABELS: Record<PaymentPill, string> = {
  esta_semana: "Vencen esta semana",
  morosos: "Morosos",
  cobrados_mes: "Cobrados este mes",
  incobrables: "Incobrables",
};

export interface PaymentsFilters {
  pill: PaymentPill | null;
  status: string[];
  method: string | null;
  dueFrom: string | null;
  dueTo: string | null;
  paidFrom: string | null;
  paidTo: string | null;
  vendedorId: string | null;
  /** «Cobrados con más de N días de atraso»: `delay_days > N`. */
  delayOver: number | null;
  q: string | null;
  page: number;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | null => {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw.trim() ? raw.trim().slice(0, 120) : null;
};

export function parsePaymentsFilters(params: Params): PaymentsFilters {
  const pill = one(params.pastilla);
  const date = (key: string) => {
    const v = one(params[key]);
    return v && isDateOnly(v) ? v : null;
  };
  const statuses = (one(params.estado) ?? "").split(",").map((s) => s.trim()).filter((s) => (PAYMENT_STATUSES as readonly string[]).includes(s));
  const over = Number(one(params.atraso));
  const page = Number(one(params.pagina));
  return {
    pill: (PAYMENT_PILLS as readonly string[]).includes(pill ?? "") ? (pill as PaymentPill) : null,
    status: statuses,
    method: one(params.metodo),
    dueFrom: date("vence_desde"),
    dueTo: date("vence_hasta"),
    paidFrom: date("cobro_desde"),
    paidTo: date("cobro_hasta"),
    vendedorId: one(params.vendedor),
    delayOver: Number.isInteger(over) && over >= 0 && one(params.atraso) !== null ? over : null,
    q: one(params.q),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function paymentsFiltersToParams(f: PaymentsFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.pill) p.set("pastilla", f.pill);
  if (f.status.length) p.set("estado", f.status.join(","));
  if (f.method) p.set("metodo", f.method);
  if (f.dueFrom) p.set("vence_desde", f.dueFrom);
  if (f.dueTo) p.set("vence_hasta", f.dueTo);
  if (f.paidFrom) p.set("cobro_desde", f.paidFrom);
  if (f.paidTo) p.set("cobro_hasta", f.paidTo);
  if (f.vendedorId) p.set("vendedor", f.vendedorId);
  if (f.delayOver !== null) p.set("atraso", String(f.delayOver));
  if (f.q) p.set("q", f.q);
  if (f.page > 1) p.set("pagina", String(f.page));
  return p;
}

export function countActivePaymentFilters(f: PaymentsFilters): number {
  return [f.status.length > 0, f.method, f.dueFrom, f.dueTo, f.paidFrom, f.paidTo, f.vendedorId, f.delayOver !== null].filter(Boolean).length;
}

export interface QueryFilter {
  column: string;
  op: "eq" | "neq" | "in" | "gte" | "lte" | "gt";
  value: string | number | string[];
}

/** «Esta semana» = hoy y los próximos 7 días, en la zona del workspace. */
export function weekRange(todayLocal: string): { from: string; to: string } {
  return { from: todayLocal, to: addDays(todayLocal, 7) };
}

/** El mes local de «hoy»: de su primer al último día. */
export function monthRange(todayLocal: string): { from: string; to: string } {
  const [y, m] = todayLocal.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

/** Los filtros de columna de `payments` que arman la consulta. La pastilla manda sobre el estado. */
export function paymentsQueryFilters(f: PaymentsFilters, todayLocal: string): QueryFilter[] {
  const out: QueryFilter[] = [];
  if (f.pill === "esta_semana") {
    const w = weekRange(todayLocal);
    out.push({ column: "status", op: "eq", value: "scheduled" }, { column: "due_date", op: "gte", value: w.from }, { column: "due_date", op: "lte", value: w.to });
  } else if (f.pill === "morosos") {
    out.push({ column: "status", op: "eq", value: "overdue" });
  } else if (f.pill === "cobrados_mes") {
    const m = monthRange(todayLocal);
    out.push({ column: "status", op: "eq", value: "paid" }, { column: "type", op: "neq", value: "refund" }, { column: "paid_on", op: "gte", value: m.from }, { column: "paid_on", op: "lte", value: m.to });
  } else if (f.pill === "incobrables") {
    out.push({ column: "status", op: "eq", value: "uncollectible" });
  } else if (f.status.length) {
    out.push({ column: "status", op: "in", value: [...f.status] });
  }
  if (f.method) out.push({ column: "payment_method", op: "eq", value: f.method });
  if (f.dueFrom) out.push({ column: "due_date", op: "gte", value: f.dueFrom });
  if (f.dueTo) out.push({ column: "due_date", op: "lte", value: f.dueTo });
  if (f.paidFrom) out.push({ column: "paid_on", op: "gte", value: f.paidFrom });
  if (f.paidTo) out.push({ column: "paid_on", op: "lte", value: f.paidTo });
  if (f.delayOver !== null) out.push({ column: "delay_days", op: "gt", value: f.delayOver });
  return out;
}

export interface PaymentListInput {
  id: string;
  sale_id: string;
  type: string;
  status: string;
  amount: unknown;
  due_date: string | null;
  paid_on: string | null;
  delay_days: number | null;
  payment_method: string | null;
  provider_fee_amount: unknown;
}

export interface PaymentListRow {
  id: string;
  saleId: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  amount: number;
  dueDate: string | null;
  paidOn: string | null;
  delay: DelayChip;
  method: string | null;
  canAct: { markPaid: boolean; reschedule: boolean };
}

export function paymentListRow(p: PaymentListInput, canManage: boolean): PaymentListRow {
  const open = p.status === "scheduled" || p.status === "overdue";
  return {
    id: p.id,
    saleId: p.sale_id,
    typeLabel: paymentTypeLabel(p.type),
    status: p.status,
    statusLabel: paymentStatusLabel(p.status),
    amount: fromCents(toCents(p.amount)),
    dueDate: p.due_date,
    paidOn: p.paid_on,
    delay: p.status === "paid" ? delayChip(p.delay_days) : { label: "—", tone: "none" },
    method: p.payment_method ? paymentMethodName(p.payment_method) : null,
    canAct: { markPaid: canManage && open && p.type !== "refund", reschedule: canManage && open && p.type !== "refund" },
  };
}

export interface PaymentsTotals {
  count: number;
  /** Suma de los montos de las filas (los reembolsos restan). */
  amount: number;
  /** De los cobrados: bruto, comisión y neto. */
  paid: { count: number; gross: number; fee: number; net: number };
}

/** Los totales del filtro, en céntimos: coinciden con la suma de las filas. */
export function paymentsTotals(rows: ReadonlyArray<Pick<PaymentListInput, "status" | "amount" | "provider_fee_amount">>): PaymentsTotals {
  let amount = 0, gross = 0, fee = 0, paidCount = 0;
  for (const r of rows) {
    const cents = toCents(r.amount);
    amount += cents;
    if (r.status === "paid") {
      paidCount++;
      gross += cents;
      fee += toCents(r.provider_fee_amount);
    }
  }
  return { count: rows.length, amount: fromCents(amount), paid: { count: paidCount, gross: fromCents(gross), fee: fromCents(fee), net: fromCents(gross - fee) } };
}
