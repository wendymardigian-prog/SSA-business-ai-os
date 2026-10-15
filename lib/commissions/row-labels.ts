/**
 * Los textos cortos de una fila de la lista de comisiones (F59): el pago («Cuota 2 de 6»), el cálculo («8 % del
 * neto» o «USD 15 fijos») y la celda del gasto («Programado 5/11»). Puro: la lista y el CSV usan lo mismo.
 */
import { formatUsd } from "@/lib/finance/format";
import { toCents } from "@/lib/sales/money";
import { formatRate } from "./describe";
import { shortCivil, type CommissionStatusResult } from "./status";

// ── El pago ────────────────────────────────────────────────────────────

/** Lo mínimo de un pago para numerar los de una venta. */
export interface NumberablePayment {
  id: string;
  sale_id: string;
  type: string;
  status: string;
  original_due_date: string | null;
  due_date: string | null;
  created_at: string;
}

export interface PaymentPosition {
  /** Posición entre los pagos de la venta (empieza en 1). `null` en un reembolso. */
  number: number | null;
  /** Cuántos pagos tiene la venta (sin reembolsos ni cancelados). */
  total: number;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Numera los pagos de cada venta con el MISMO criterio que `commission_facts` (SQL): sin reembolsos ni cancelados,
 * ordenados por vencimiento original (o el vigente, los sin fecha al final), alta e id. Es lo que las reglas
 * llaman «número de pago», así la lista dice lo mismo que la regla que se aplicó.
 */
export function paymentPositions(payments: readonly NumberablePayment[]): Map<string, PaymentPosition> {
  const bySale = new Map<string, NumberablePayment[]>();
  for (const p of payments) {
    if (p.type === "refund" || p.status === "cancelled") continue;
    const list = bySale.get(p.sale_id) ?? [];
    list.push(p);
    bySale.set(p.sale_id, list);
  }
  const out = new Map<string, PaymentPosition>();
  for (const list of bySale.values()) {
    list.sort((a, b) => {
      const da = a.original_due_date ?? a.due_date;
      const db = b.original_due_date ?? b.due_date;
      if (da !== db) {
        if (da === null) return 1;
        if (db === null) return -1;
        return cmp(da, db);
      }
      return cmp(a.created_at, b.created_at) || cmp(a.id, b.id);
    });
    list.forEach((p, i) => out.set(p.id, { number: i + 1, total: list.length }));
  }
  for (const p of payments) if (p.type === "refund") out.set(p.id, { number: null, total: bySale.get(p.sale_id)?.length ?? 0 });
  return out;
}

/** «Cuota 2 de 6», «Pago completo», «Reserva», «Reembolso». Sin pago (un ajuste a mano): «—». */
export function paymentLabel(payment: { type: string; number: number | null; total: number } | null | undefined): string {
  if (!payment) return "—";
  switch (payment.type) {
    case "installment":
      return payment.number && payment.total >= payment.number ? `Cuota ${payment.number} de ${payment.total}` : payment.number ? `Cuota ${payment.number}` : "Cuota";
    case "full":
      return "Pago completo";
    case "reservation":
      return "Reserva";
    case "refund":
      return "Reembolso";
    default:
      return payment.type || "—";
  }
}

// ── El cálculo ─────────────────────────────────────────────────────────

/**
 * «8 % del neto», «5 % del cobrado», «USD 15,00 fijos» a partir de la foto de la regla (`rule_snapshot`). Sin foto
 * (un ajuste) devuelve `null`.
 */
export function calcLabel(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const s = snapshot as Record<string, unknown>;
  if (s.calc_type === "fixed") return `${formatUsd(toCents(s.fixed_amount))} fijos`;
  if (s.calc_type === "percent") return `${formatRate(Number(s.rate) || 0)} % del ${s.base === "net_of_fees" ? "neto" : "cobrado"}`;
  return null;
}

// ── El gasto ───────────────────────────────────────────────────────────

/**
 * Lo que dice la columna «Gasto»: el estado del gasto y su fecha («Programado 5/11», «Pagado 6/11»). Sin gasto, `null`.
 * El link al gasto lo decide quien dibuja (solo con `expenses.view`).
 */
export function expenseCellText(status: CommissionStatusResult, hasExpense: boolean): string | null {
  if (!hasExpense) return null;
  if (status.key === "pagada") return status.date ? `Pagado ${shortCivil(status.date)}` : "Pagado";
  return status.detail || "En gasto";
}
