/**
 * El plan de pagos de una venta (plano F20): armarlo, validar que cuadre y avisar
 * lo que va a nacer vencido. Funciones puras, en céntimos.
 *
 * Tipos de financiamiento:
 *   full                       un solo pago
 *   reservation_balance        reserva + un pago por el saldo
 *   installments               cuotas (con un primer pago opcional)
 *   reservation_installments   reserva + cuotas
 *   subscription               a mano: importe del ciclo, sin cuadre ni saldo
 *
 * La última cuota absorbe el redondeo: 1250 en 3 → 416,67 · 416,67 · 416,66.
 * Las fechas mensuales conservan el día de la primera: del 31 de enero caen el 28
 * (o 29) de febrero y el 31 de marzo.
 */
import { addDays, addMonths } from "@/lib/shared/dates";
import type { FinancingType, PaymentType } from "./labels";
import { fromCents, toCents } from "@/lib/shared/money";

export type Frequency = "weekly" | "biweekly" | "monthly";

export interface PlannedPayment {
  type: PaymentType;
  amount: number;
  status: "paid" | "scheduled";
  /** Vencimiento (YYYY-MM-DD). En un pago ya cobrado es la fecha efectiva. */
  due_date: string | null;
  /** Solo si ya está cobrado: la fecha efectiva (local). */
  paid_on?: string | null;
  payment_method?: string | null;
}

export interface FirstPaymentInput {
  amount: unknown;
  paid: boolean;
  /** Fecha efectiva (si está cobrado) o vencimiento (si está programado). */
  date: string;
  method?: string | null;
}

export interface PlanParams {
  total: unknown;
  financing: FinancingType;
  first: FirstPaymentInput;
  installments?: number;
  /** Alternativa a `installments`: el monto por cuota (la última puede ser menor). */
  installmentAmount?: unknown;
  frequency: Frequency;
  /** El vencimiento de la primera cuota (o del pago del saldo). */
  firstDue: string;
}

/** `total` repartido en `count` partes enteras de céntimos; los céntimos que sobran van a las primeras. */
export function splitCents(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalCents / count);
  const extra = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

export function dueDateAt(firstDue: string, frequency: Frequency, index: number): string {
  if (frequency === "weekly") return addDays(firstDue, 7 * index);
  if (frequency === "biweekly") return addDays(firstDue, 14 * index);
  return addMonths(firstDue, index);
}

/** El tipo del primer pago según el financiamiento. */
export function firstPaymentType(financing: FinancingType): PaymentType {
  if (financing === "full") return "full";
  if (financing === "reservation_balance" || financing === "reservation_installments") return "reservation";
  return "installment";
}

export function buildPaymentPlan(params: PlanParams): PlannedPayment[] {
  const totalCents = toCents(params.total);
  const firstCents = Math.max(0, toCents(params.first.amount));
  const plan: PlannedPayment[] = [];

  const first: PlannedPayment | null =
    firstCents > 0 || params.financing === "full" || params.financing === "subscription"
      ? {
          type: firstPaymentType(params.financing),
          amount: fromCents(params.financing === "full" ? totalCents : firstCents),
          status: params.first.paid ? "paid" : "scheduled",
          due_date: params.first.date,
          paid_on: params.first.paid ? params.first.date : null,
          payment_method: params.first.method ?? null,
        }
      : null;
  if (first) plan.push(first);

  if (params.financing === "full" || params.financing === "subscription") return plan;

  const remaining = totalCents - (first ? toCents(first.amount) : 0);
  if (remaining <= 0) return plan;

  let parts: number[];
  if (params.financing === "reservation_balance") {
    parts = [remaining];
  } else if (params.installmentAmount != null && toCents(params.installmentAmount) > 0) {
    const each = toCents(params.installmentAmount);
    const count = Math.ceil(remaining / each);
    parts = Array.from({ length: count }, (_, i) => (i < count - 1 ? each : remaining - each * (count - 1)));
  } else {
    parts = splitCents(remaining, Math.max(1, Math.floor(params.installments ?? 1)));
  }

  parts.forEach((cents, i) => {
    plan.push({
      type: params.financing === "reservation_balance" ? "installment" : "installment",
      amount: fromCents(cents),
      status: "scheduled",
      due_date: dueDateAt(params.firstDue, params.frequency, i),
      paid_on: null,
      payment_method: null,
    });
  });
  return plan;
}

export interface BalanceCheck {
  ok: boolean;
  /** final − suma de los pagos del plan, en céntimos. Positivo = falta asignar; negativo = te pasaste. */
  diffCents: number;
}

/** El cuadre: la suma de los pagos (sin reembolsos) tiene que dar exactamente el final. No aplica a una suscripción. */
export function validatePlanBalances(finalAmount: unknown, payments: ReadonlyArray<{ amount: unknown; type?: string }>): BalanceCheck {
  const sum = payments.filter((p) => p.type !== "refund").reduce((acc, p) => acc + toCents(p.amount), 0);
  const diffCents = toCents(finalAmount) - sum;
  return { ok: diffCents === 0, diffCents };
}

/** El texto de la línea de cuadre: «Asignado $X de $Y» / «Falta asignar $Z» / «Te pasaste por $Z». */
export function balanceLine(finalAmount: unknown, payments: ReadonlyArray<{ amount: unknown; type?: string }>, format: (n: number) => string): string {
  const { ok, diffCents } = validatePlanBalances(finalAmount, payments);
  const assigned = toCents(finalAmount) - diffCents;
  if (ok) return `Asignado ${format(fromCents(assigned))} de ${format(fromCents(toCents(finalAmount)))}`;
  return diffCents > 0 ? `Falta asignar ${format(fromCents(diffCents))}` : `Te pasaste por ${format(fromCents(-diffCents))}`;
}

/** Los pagos programados cuyo vencimiento ya pasó (el aviso «ya venció»). */
export function bornOverdue(payments: ReadonlyArray<{ status: string; due_date: string | null }>, todayLocal: string): number[] {
  const out: number[] = [];
  payments.forEach((p, i) => {
    if (p.status === "scheduled" && p.due_date && p.due_date < todayLocal) out.push(i);
  });
  return out;
}
