/**
 * La tabla de pagos de la ficha de una venta (plano F28). Puro: qué se dice en cada celda y qué
 * acciones ofrece cada fila. Los cálculos de plata van en céntimos.
 */
import { delayChip, type DelayChip } from "./delay";
import { fromCents, toCents } from "./money";
import { paymentMethodName, type PaymentMethodDef } from "./payment-methods";
import { paymentStatusLabel, paymentTypeLabel } from "./labels";
import { saleBalance, saleExpected, salePaid } from "./sale-math";

export interface TablePayment {
  id: string;
  type: string;
  status: string;
  amount: unknown;
  due_date: string | null;
  original_due_date: string | null;
  paid_on: string | null;
  delay_days: number | null;
  payment_method: string | null;
  provider_fee_amount: unknown;
  /** El porcentaje y el fijo con los que se calculó la comisión al cobrar (Extra I). Null en pagos anteriores. */
  provider_fee_percent?: unknown;
  provider_fee_fixed?: unknown;
  receipt_path: string | null;
  reschedule_count: number;
  notes: string | null;
}

export interface RowActions {
  markPaid: boolean;
  reschedule: boolean;
  uncollectible: boolean;
  revert: boolean;
  receipt: "view" | "upload" | null;
}

export interface PaymentRowView {
  id: string;
  index: number;
  typeLabel: string;
  amount: number;
  /** El vencimiento vigente y, entre paréntesis, el original si se reprogramó. */
  due: { current: string | null; original: string | null };
  paidOn: string | null;
  delay: DelayChip;
  statusLabel: string;
  status: string;
  method: string | null;
  fee: number | null;
  /** "2,9 % + 0,30" con lo que se congeló al cobrar; null si el pago no lo guardó o no tuvo comisión. */
  feeNote: string | null;
  /** Lo cobrado menos la comisión (null si no está cobrado). */
  net: number | null;
  /** Con `payments.manage` y un cobro que no es reembolso: se puede corregir la comisión (F6). */
  canCorrectFee: boolean;
  actions: RowActions;
}

/** Con `payments.manage`: qué botones lleva cada fila según su estado. Sin el permiso, ninguno. */
export function rowActions(p: Pick<TablePayment, "status" | "type" | "receipt_path">, canManage: boolean): RowActions {
  const none: RowActions = { markPaid: false, reschedule: false, uncollectible: false, revert: false, receipt: p.receipt_path ? "view" : null };
  if (!canManage) return none;
  const open = p.status === "scheduled" || p.status === "overdue";
  return {
    markPaid: open && p.type !== "refund",
    reschedule: open && p.type !== "refund",
    uncollectible: p.status === "overdue" && p.type !== "refund",
    revert: (p.status === "paid" || p.status === "uncollectible") && p.type !== "refund",
    receipt: p.receipt_path ? "view" : p.status === "paid" && p.type !== "refund" ? "upload" : null,
  };
}

const PCT = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const FIXED = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2,9 % + 0,30": lo que se congeló al cobrar. Null si no hay nada que mostrar. */
export function feeSpecNote(percent: unknown, fixed: unknown): string | null {
  if (percent == null && fixed == null) return null;
  const pct = Number(percent) || 0;
  const fix = Number(fixed) || 0;
  if (pct <= 0 && fix <= 0) return null;
  const parts: string[] = [];
  if (pct > 0) parts.push(`${PCT.format(pct)} %`);
  if (fix > 0) parts.push(FIXED.format(fix));
  return parts.join(" + ");
}

export function paymentRows(payments: readonly TablePayment[], canManage: boolean, catalog?: readonly PaymentMethodDef[] | null): PaymentRowView[] {
  return payments.map((p, i) => ({
    id: p.id,
    index: i + 1,
    typeLabel: paymentTypeLabel(p.type),
    amount: fromCents(toCents(p.amount)),
    due: {
      current: p.due_date,
      original: p.reschedule_count > 0 && p.original_due_date && p.original_due_date !== p.due_date ? p.original_due_date : null,
    },
    paidOn: p.paid_on,
    delay: p.status === "paid" ? delayChip(p.delay_days) : { label: "—", tone: "none" },
    statusLabel: paymentStatusLabel(p.status),
    status: p.status,
    method: p.payment_method ? paymentMethodName(p.payment_method, catalog) : null,
    fee: p.status === "paid" && p.provider_fee_amount != null && toCents(p.provider_fee_amount) > 0 ? fromCents(toCents(p.provider_fee_amount)) : null,
    feeNote: p.status === "paid" && p.provider_fee_amount != null && toCents(p.provider_fee_amount) > 0 ? feeSpecNote(p.provider_fee_percent, p.provider_fee_fixed) : null,
    net: p.status === "paid" ? fromCents(toCents(p.amount) - (p.provider_fee_amount != null ? toCents(p.provider_fee_amount) : 0)) : null,
    canCorrectFee: canManage && p.status === "paid" && p.type !== "refund",
    actions: rowActions(p, canManage),
  }));
}

export interface TableFooter {
  final: number;
  paid: number;
  balance: number;
  expected: number;
  /** El saldo se pinta en rojo si no es 0 y no es una suscripción. */
  balanceRed: boolean;
  /** Cobrado de más (saldo negativo): sugiere un reembolso. */
  overpaidBy: number;
}

export function tableFooter(finalAmount: unknown, payments: readonly TablePayment[], isSubscription: boolean): TableFooter {
  const balance = saleBalance(finalAmount, payments);
  return {
    final: fromCents(toCents(finalAmount)),
    paid: salePaid(payments),
    balance,
    expected: saleExpected(payments),
    balanceRed: !isSubscription && toCents(balance) !== 0,
    overpaidBy: balance < 0 ? Math.abs(balance) : 0,
  };
}
