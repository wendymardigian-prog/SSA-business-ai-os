/**
 * La tabla de pagos de la ficha de una venta (plano F28). Puro: qué se dice en cada celda y qué
 * acciones ofrece cada fila. Los cálculos de plata van en céntimos.
 */
import { delayChip, type DelayChip } from "./delay";
import { fromCents, toCents } from "./money";
import { paymentMethodName } from "./payment-methods";
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

export function paymentRows(payments: readonly TablePayment[], canManage: boolean): PaymentRowView[] {
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
    method: p.payment_method ? paymentMethodName(p.payment_method) : null,
    fee: p.status === "paid" && p.provider_fee_amount != null && toCents(p.provider_fee_amount) > 0 ? fromCents(toCents(p.provider_fee_amount)) : null,
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
