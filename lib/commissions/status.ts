/**
 * El estado de una comisión (F56). Se DERIVA, nunca se guarda: el estado de pago se lee del gasto. Puro: una
 * sola fuente para los chips, los filtros y el CSV.
 *
 * Orden de precedencia (el primero que se cumple gana):
 *   1. anulada (`voided_at`)                                      → Anulada
 *   2. sin persona (`user_id` null)                               → Sin persona
 *   3. en un gasto PAGADO                                         → Pagada (con la fecha de pago)
 *   4. en un gasto programado / vencido / por revisar             → En gasto (con la fecha y el estado del gasto)
 *   5. `available_on` posterior a hoy                             → Retenida (hasta esa fecha)
 *   6. si no                                                      → Pendiente
 *
 * Un gasto anulado suelta sus comisiones (trigger `expenses_release_commissions`): si por una carrera se
 * lee una comisión con `expense_id` y el gasto ya anulado, el vínculo está muerto y se evalúa como si no
 * tuviera gasto. Si el gasto no se cargó (`expense` null) pero la comisión tiene `expense_id`, sigue siendo
 * «En gasto», sin fecha.
 */
import type { CivilDate } from "@/lib/finance/dates";
import { EXPENSE_STATUSES, isExpenseStatus, type ExpenseStatus, type StatusTone } from "@/lib/finance/expense-status";

export const COMMISSION_STATUS_KEYS = ["anulada", "sin_persona", "pagada", "en_gasto", "retenida", "pendiente"] as const;
export type CommissionStatusKey = (typeof COMMISSION_STATUS_KEYS)[number];

export const COMMISSION_STATUSES: Record<CommissionStatusKey, { label: string; tone: StatusTone }> = {
  anulada: { label: "Anulada", tone: "gray" },
  sin_persona: { label: "Sin persona", tone: "red" },
  pagada: { label: "Pagada", tone: "green" },
  en_gasto: { label: "En gasto", tone: "blue" },
  retenida: { label: "Retenida", tone: "amber" },
  pendiente: { label: "Pendiente", tone: "blue" },
};

export function isCommissionStatus(value: unknown): value is CommissionStatusKey {
  return typeof value === "string" && (COMMISSION_STATUS_KEYS as readonly string[]).includes(value);
}

export function commissionStatusLabel(key: string): string {
  return isCommissionStatus(key) ? COMMISSION_STATUSES[key].label : key;
}

/** Lo que el estado necesita de la comisión. */
export interface CommissionStatusInput {
  voided_at: string | null;
  user_id: string | null;
  expense_id: string | null;
  available_on: CivilDate;
}

/** Lo único que el estado necesita del gasto (F59: nunca más que esto). */
export interface CommissionExpenseRef {
  status: string;
  scheduled_date: CivilDate | null;
  paid_date: CivilDate | null;
}

export interface CommissionStatusResult {
  key: CommissionStatusKey;
  label: string;
  tone: StatusTone;
  /** Pagada: la fecha de pago. En gasto: la fecha programada. Retenida: hasta cuándo. Si no, null. */
  date: CivilDate | null;
  /** Solo en gasto: el estado del gasto. */
  expenseStatus: ExpenseStatus | null;
  /** El texto corto que acompaña al chip: «Pagada 6/11», «Programado 5/11», «Hasta el 5/11», o «». */
  detail: string;
}

/** `2026-11-05` → `5/11`. */
export function shortCivil(date: CivilDate): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d}/${m}`;
}

export function commissionStatus(c: CommissionStatusInput, expense: CommissionExpenseRef | null | undefined, todayLocal: CivilDate): CommissionStatusResult {
  const result = (key: CommissionStatusKey, date: CivilDate | null = null, expenseStatus: ExpenseStatus | null = null, detail = ""): CommissionStatusResult => ({
    key, ...COMMISSION_STATUSES[key], date, expenseStatus, detail,
  });

  if (c.voided_at) return result("anulada");
  if (c.user_id === null) return result("sin_persona");

  if (c.expense_id) {
    const status = expense && isExpenseStatus(expense.status) ? expense.status : null;
    if (status === "pagado") {
      const date = expense?.paid_date ?? null;
      return result("pagada", date, status, date ? `Pagada ${shortCivil(date)}` : "Pagada");
    }
    if (status !== "anulado") {
      const date = expense?.scheduled_date ?? null;
      const label = status ? EXPENSE_STATUSES[status].label : "";
      const detail = status === "por_revisar" || !date ? label : `${label} ${shortCivil(date)}`;
      return result("en_gasto", date, status, detail);
    }
  }

  if (c.available_on > todayLocal) return result("retenida", c.available_on, null, `Hasta el ${shortCivil(c.available_on)}`);
  return result("pendiente");
}
