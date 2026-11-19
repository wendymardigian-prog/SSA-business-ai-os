/**
 * Los pagos que faltan cobrar de una venta y cuál es «el próximo». Puro.
 *
 * Abierto = moroso o programado (los mismos que suma `saleExpected`). Cobrados, reembolsos, incobrables y anulados no
 * cuentan. «El próximo» es el abierto con la fecha más vieja, aunque ya esté vencido: es lo que el cliente debe primero.
 */
import { fromCents, toCents } from "@/lib/shared/money";

export interface PaymentLike {
  id?: string | null;
  amount: unknown;
  status: string;
  due_date?: string | null;
}

export interface OpenPayment {
  id: string | null;
  /** `YYYY-MM-DD`, o null si el pago no tiene fecha. */
  dueDate: string | null;
  /** En dólares (pasado por céntimos). */
  amount: number;
  overdue: boolean;
}

const OPEN = new Set(["scheduled", "overdue"]);

/** Los pagos abiertos ordenados por fecha (los sin fecha al final; desempate por id). */
export function openPayments(payments: ReadonlyArray<PaymentLike> | null | undefined): OpenPayment[] {
  return (payments ?? [])
    .filter((p) => OPEN.has(p.status))
    .map((p) => ({ id: p.id ?? null, dueDate: p.due_date ?? null, amount: fromCents(toCents(p.amount)), overdue: p.status === "overdue" }))
    .sort((a, b) => {
      if (a.dueDate !== b.dueDate) {
        if (a.dueDate === null) return 1;
        if (b.dueDate === null) return -1;
        return a.dueDate < b.dueDate ? -1 : 1;
      }
      return (a.id ?? "").localeCompare(b.id ?? "");
    });
}

/** El primer pago abierto, o null si no queda ninguno. */
export function nextPayment(payments: ReadonlyArray<PaymentLike> | null | undefined): OpenPayment | null {
  return openPayments(payments)[0] ?? null;
}
