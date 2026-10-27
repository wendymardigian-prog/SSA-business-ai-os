/**
 * Las reglas de cobrar, revertir, reprogramar, marcar incobrable, reembolsar y agregar un pago
 * (plano F29 y F32). Puras: las Server Actions solo las llaman y escriben. Todo en céntimos.
 */
import { addDays, isDateOnly } from "@/lib/shared/dates";
import { buildPaymentOptionSnapshot, computeProviderFee, type PaymentOptionSnapshot } from "./fees";
import { fromCents, toCents } from "@/lib/shared/money";
import { findMethod, isPaymentMethodKey, type PaymentMethodDef } from "./payment-methods";
import { overdueCutoff } from "./overdue";
import { wallClockToUtc } from "@/lib/scheduling/time/tz";

export interface RulePayment {
  type: string;
  status: string;
  amount: unknown;
  due_date: string | null;
}

export type RuleResult<T> = ({ ok: true } & T) | { ok: false; error: string };

// ── Marcar cobrado (F29) ───────────────────────────────────────────────

export interface MarkPaidInput {
  /** Lo que entró, en dólares. Por defecto el programado. */
  amount: unknown;
  /** Fecha efectiva (local, `YYYY-MM-DD`). */
  paidOn: string;
  method: string;
  notes?: string | null;
}

export interface MarkPaidContext {
  payment: RulePayment;
  saleDate: string;
  todayLocal: string;
  timeZone: string;
  now: Date;
  enabledMethods: readonly string[];
  /**
   * Los métodos DEL NEGOCIO (`workspaces.payment_methods`) con su comisión. Sin esto se usa el catálogo de
   * arranque (los 5 de siempre, comisión 0), que es lo que hacían los llamadores antes del Extra I.
   */
  methods?: readonly PaymentMethodDef[];
}

export interface PaidPatch {
  status: "paid";
  amount: number;
  paid_at: string;
  paid_on: string;
  payment_method: string;
  payment_option_snapshot: PaymentOptionSnapshot | null;
  /** La comisión queda CONGELADA al cobrar: es la que Gastos suma por método y mes. */
  provider_fee_amount: number;
  /** El porcentaje y el fijo con los que se calculó, congelados junto con el total (Extra I, MP). */
  provider_fee_percent: number;
  provider_fee_fixed: number;
  notes: string | null;
}

export function planMarkPaid(input: MarkPaidInput, ctx: MarkPaidContext): RuleResult<{ patch: PaidPatch; partial: PartialOffer | null; overpaidBy: number }> {
  const { payment } = ctx;
  if (payment.status === "paid") return { ok: false, error: "Este pago ya está cobrado" };
  if (payment.status !== "scheduled" && payment.status !== "overdue") return { ok: false, error: "Solo se puede cobrar un pago programado o moroso" };
  if (payment.type === "refund") return { ok: false, error: "Un reembolso no se cobra" };

  const amountCents = toCents(input.amount);
  if (!(amountCents > 0)) return { ok: false, error: "El monto cobrado tiene que ser mayor que cero" };
  if (!isDateOnly(input.paidOn)) return { ok: false, error: "La fecha del cobro no es válida" };
  if (input.paidOn < ctx.saleDate) return { ok: false, error: "El cobro no puede ser anterior a la fecha de la venta" };
  if (input.paidOn > ctx.todayLocal) return { ok: false, error: "El cobro no puede tener fecha futura" };
  const known = ctx.methods ? findMethod(ctx.methods, input.method) : isPaymentMethodKey(input.method) ? findMethod(undefined, input.method) : null;
  if (!known) return { ok: false, error: "Elegí el método con el que se cobró" };
  if (!ctx.enabledMethods.includes(input.method)) return { ok: false, error: "Ese método de pago no está habilitado" };

  const paidAt = input.paidOn === ctx.todayLocal ? ctx.now : wallClockToUtc(input.paidOn, "12:00", ctx.timeZone);
  const scheduledCents = toCents(payment.amount);
  return {
    ok: true,
    patch: {
      status: "paid",
      amount: fromCents(amountCents),
      paid_at: paidAt.toISOString(),
      paid_on: input.paidOn,
      payment_method: input.method,
      payment_option_snapshot: buildPaymentOptionSnapshot(input.method, ctx.methods),
      provider_fee_amount: computeProviderFee(fromCents(amountCents), input.method, ctx.methods),
      provider_fee_percent: known.feePercent,
      provider_fee_fixed: known.feeFixed,
      notes: input.notes?.trim() || null,
    },
    partial: amountCents < scheduledCents ? partialOffer(scheduledCents, amountCents, input.paidOn) : null,
    overpaidBy: amountCents > scheduledCents ? fromCents(amountCents - scheduledCents) : 0,
  };
}

export interface PartialOffer {
  /** Lo que falta (el programado menos lo que entró), en dólares. */
  difference: number;
  /** La fecha sugerida para la cuota por la diferencia: +30 días. */
  suggestedDue: string;
}

/** Un cobro parcial NO crea nada solo: la respuesta OFRECE una cuota por la diferencia. */
export function partialOffer(scheduledCents: number, paidCents: number, paidOn: string): PartialOffer | null {
  if (paidCents >= scheduledCents) return null;
  return { difference: fromCents(scheduledCents - paidCents), suggestedDue: addDays(paidOn, 30) };
}

// ── Revertir un cobro (F29) ────────────────────────────────────────────

/**
 * A qué estado vuelve un cobro revertido: `overdue` si su vencimiento ya pasó (con los días de gracia
 * del workspace, como el barrido), `scheduled` si no. Siempre en la zona del workspace.
 */
export function revertTarget(payment: Pick<RulePayment, "due_date">, todayLocal: string, graceDays: number): "scheduled" | "overdue" {
  if (!payment.due_date) return "scheduled";
  return payment.due_date < overdueCutoff(todayLocal, graceDays) ? "overdue" : "scheduled";
}

export function planRevert(payment: RulePayment, reason: string | null | undefined, todayLocal: string, graceDays: number): RuleResult<{ target: "scheduled" | "overdue" }> {
  if (payment.status !== "paid" && payment.status !== "uncollectible") return { ok: false, error: "Solo se puede revertir un pago cobrado o incobrable" };
  if (payment.type === "refund") return { ok: false, error: "Un reembolso no se revierte desde acá" };
  if (!(reason ?? "").trim()) return { ok: false, error: "Explicá el motivo" };
  return { ok: true, target: revertTarget(payment, todayLocal, graceDays) };
}

/** Lo que se limpia al revertir un cobro: nada de lo cobrado queda guardado. */
export const REVERT_CLEARED_FIELDS = {
  paid_at: null,
  paid_on: null,
  provider_fee_amount: null,
  provider_fee_percent: null,
  provider_fee_fixed: null,
  payment_option_snapshot: null,
  payment_method: null,
} as const;

// ── Corregir la comisión de un cobro (Extra I, MP, F6) ────────────────

/**
 * La comisión que el procesador SE QUEDÓ de verdad puede diferir de la calculada (redondeos, un cargo
 * que llegó distinto). Se corrige SOLO el total (`provider_fee_amount`): el porcentaje y el fijo quedan
 * como estaban, como registro de lo que se calculó. Queda en el historial con su motivo.
 */
export function planFeeCorrection(
  payment: Pick<RulePayment, "type" | "status" | "amount">,
  input: { feeAmount: unknown; reason: string | null | undefined },
): RuleResult<{ feeAmount: number }> {
  if (payment.status !== "paid" || payment.type === "refund") return { ok: false, error: "Solo se puede corregir la comisión de un cobro" };
  const fee = toCents(input.feeAmount);
  if (!(fee >= 0) || String(input.feeAmount ?? "").trim() === "") return { ok: false, error: "La comisión tiene que ser un monto de cero o más" };
  if (fee > toCents(payment.amount)) return { ok: false, error: `La comisión no puede superar lo cobrado: máximo ${fromCents(toCents(payment.amount)).toFixed(2)}` };
  if (!(input.reason ?? "").trim()) return { ok: false, error: "Explicá el motivo de la corrección" };
  return { ok: true, feeAmount: fromCents(fee) };
}

// ── Reprogramar (F32) ──────────────────────────────────────────────────

export function planReschedule(
  payment: RulePayment,
  input: { newDate: string; reason: string | null | undefined },
  todayLocal: string,
  graceDays: number,
): RuleResult<{ status: "scheduled" | "overdue" }> {
  if (payment.status !== "scheduled" && payment.status !== "overdue") return { ok: false, error: "Solo se puede reprogramar un pago programado o moroso" };
  if (!isDateOnly(input.newDate)) return { ok: false, error: "La fecha nueva no es válida" };
  if (!(input.reason ?? "").trim()) return { ok: false, error: "Explicá el motivo de la reprogramación" };
  if (input.newDate === payment.due_date) return { ok: false, error: "Elegí una fecha distinta a la actual" };
  // Un moroso vuelve a programado si la fecha nueva ya no está vencida; si sigue vencida, sigue moroso.
  const status = payment.status === "overdue" && input.newDate < overdueCutoff(todayLocal, graceDays) ? "overdue" : "scheduled";
  return { ok: true, status };
}

// ── Incobrable (F32) ───────────────────────────────────────────────────

export function planUncollectible(payment: RulePayment, reason: string | null | undefined): RuleResult<object> {
  if (payment.status !== "overdue") return { ok: false, error: "Solo un pago moroso se puede marcar incobrable" };
  if (!(reason ?? "").trim()) return { ok: false, error: "Explicá el motivo" };
  return { ok: true };
}

// ── Reembolso (F32) ────────────────────────────────────────────────────

export interface RefundContext {
  /** Cobrado neto de la venta, en céntimos (los reembolsos anteriores ya están restados). */
  netPaidCents: number;
  saleDate: string;
  todayLocal: string;
}

export function planRefund(input: { amount: unknown; date: string; reason: string | null | undefined }, ctx: RefundContext): RuleResult<{ amountCents: number; total: boolean; scope: "total" | "partial" }> {
  const cents = toCents(input.amount);
  if (!(cents > 0)) return { ok: false, error: "El monto del reembolso tiene que ser mayor que cero" };
  if (ctx.netPaidCents <= 0) return { ok: false, error: "Esta venta no tiene nada cobrado para reembolsar" };
  if (cents > ctx.netPaidCents) return { ok: false, error: `El reembolso no puede superar lo cobrado: máximo ${fromCents(ctx.netPaidCents).toFixed(2)}` };
  if (!isDateOnly(input.date)) return { ok: false, error: "La fecha del reembolso no es válida" };
  if (input.date < ctx.saleDate) return { ok: false, error: "El reembolso no puede ser anterior a la fecha de la venta" };
  if (input.date > ctx.todayLocal) return { ok: false, error: "El reembolso no puede tener fecha futura" };
  if (!(input.reason ?? "").trim()) return { ok: false, error: "Explicá el motivo del reembolso" };
  const total = cents === ctx.netPaidCents;
  return { ok: true, amountCents: cents, total, scope: total ? "total" : "partial" };
}

// ── Agregar un pago a mano (F28) ───────────────────────────────────────

export function planAddPayment(
  input: { amount: unknown; dueDate: string; method?: string | null },
  enabledMethods: readonly string[],
  methods?: readonly PaymentMethodDef[],
): RuleResult<{ amount: number }> {
  const cents = toCents(input.amount);
  if (!(cents > 0)) return { ok: false, error: "El monto tiene que ser mayor que cero" };
  if (!isDateOnly(input.dueDate)) return { ok: false, error: "La fecha de vencimiento no es válida" };
  const isKnown = (key: string) => (methods ? findMethod(methods, key) !== null : isPaymentMethodKey(key));
  if (input.method && (!isKnown(input.method) || !enabledMethods.includes(input.method))) return { ok: false, error: "Ese método de pago no está habilitado" };
  return { ok: true, amount: fromCents(cents) };
}
