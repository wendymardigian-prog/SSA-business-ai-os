/**
 * El resumen «Qué va a pasar» del asistente (plano F21): el estado en que queda la venta,
 * cuántos pagos se crean, el primero, cuándo vence el próximo y los flujos que se van a
 * disparar. Usa la MISMA función de estado que `create_sale`, así lo que se promete es lo
 * que pasa.
 */
import { balanceLine, validatePlanBalances } from "../payment-plan";
import { formatMoney } from "../format";
import { saleStatusLabel } from "../labels";
import { deriveSaleStatus } from "../sale-status";
import type { PlannedPayment } from "../payment-plan";

export interface SummaryInput {
  financing: string;
  finalAmount: number;
  payments: readonly PlannedPayment[];
  todayLocal: string;
  /** Los flujos publicados que se van a disparar (los calcula quien llama; hasta B4 puede ser vacío). */
  matchingFlows?: readonly string[];
}

export interface SaleSummary {
  status: string;
  statusLabel: string;
  paymentsCount: number;
  first: { amount: number; status: "paid" | "scheduled" } | null;
  nextDue: string | null;
  /** El cuadre: «Asignado $X de $Y» / «Falta asignar $Z» / «Te pasaste por $Z». */
  balanceLine: string;
  balanced: boolean;
  /** «Guardar» se habilita (suscripción: siempre). */
  canSave: boolean;
  flows: string[];
}

export function buildSummary(input: SummaryInput): SaleSummary {
  const status = deriveSaleStatus(
    { financing_type: input.financing, final_amount: input.finalAmount },
    input.payments.map((p) => ({ type: p.type, status: p.status, amount: p.amount })),
  );
  const subscription = input.financing === "subscription";
  const balance = validatePlanBalances(input.finalAmount, input.payments);
  const upcoming = input.payments
    .filter((p) => p.status === "scheduled" && p.due_date && p.due_date >= input.todayLocal)
    .map((p) => p.due_date as string)
    .sort();
  const first = input.payments[0];

  return {
    status,
    statusLabel: saleStatusLabel(status),
    paymentsCount: input.payments.length,
    first: first ? { amount: first.amount, status: first.status } : null,
    nextDue: upcoming[0] ?? null,
    balanceLine: balanceLine(input.finalAmount, input.payments, formatMoney),
    balanced: balance.ok,
    canSave: input.payments.length > 0 && (subscription || balance.ok),
    flows: [...(input.matchingFlows ?? [])],
  };
}
