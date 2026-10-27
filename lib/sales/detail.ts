/**
 * Los números de la cabecera de la ficha de una venta (plano F26). Puro, en céntimos.
 * El saldo es final − cobrado neto: los reembolsos son filas cobradas con monto negativo
 * y restan solos; un incobrable NO cambia el saldo.
 */
import { fromCents, toCents } from "@/lib/shared/money";
import { saleBalance, saleExpected, salePaid } from "./sale-math";

export interface DetailPayment {
  type: string;
  status: string;
  amount: unknown;
  due_date: string | null;
}

export interface SaleNumbers {
  total: number;
  paid: number;
  /** Lo reembolsado, en positivo. */
  refunded: number;
  balance: number;
  /** Lo que falta por cobrar (programados y morosos). */
  expected: number;
  /** El próximo vencimiento (el más cercano entre los programados y morosos). */
  nextDue: string | null;
}

export function saleNumbers(finalAmount: unknown, payments: readonly DetailPayment[]): SaleNumbers {
  const refundedCents = payments
    .filter((p) => p.status === "paid" && toCents(p.amount) < 0)
    .reduce((acc, p) => acc + Math.abs(toCents(p.amount)), 0);
  const due = payments
    .filter((p) => (p.status === "scheduled" || p.status === "overdue") && p.due_date)
    .map((p) => p.due_date as string)
    .sort();
  return {
    total: fromCents(toCents(finalAmount)),
    paid: salePaid(payments),
    refunded: fromCents(refundedCents),
    balance: saleBalance(finalAmount, payments),
    expected: saleExpected(payments),
    nextDue: due[0] ?? null,
  };
}
