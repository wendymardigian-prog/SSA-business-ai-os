/**
 * Los estados de un gasto y lo que se puede hacer en cada uno (GF6). Puro: una sola fuente para los chips,
 * los filtros, el CSV y las acciones.
 *
 *   Por revisar  falta el monto (un recurrente variable, o un gasto cargado sin monto)
 *   Programado   tiene fecha de pago y todavía no llegó (o es hoy)
 *   Vencido      la fecha programada ya pasó y no se pagó
 *   Pagado       tiene fecha de pago efectiva
 *   Anulado      final: no se edita
 */
import type { CivilDate } from "./dates";

export const EXPENSE_STATUS_KEYS = ["por_revisar", "programado", "vencido", "pagado", "anulado"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUS_KEYS)[number];

export type StatusTone = "amber" | "blue" | "red" | "green" | "gray";

export const EXPENSE_STATUSES: Record<ExpenseStatus, { label: string; tone: StatusTone }> = {
  por_revisar: { label: "Por revisar", tone: "amber" },
  programado: { label: "Programado", tone: "blue" },
  vencido: { label: "Vencido", tone: "red" },
  pagado: { label: "Pagado", tone: "green" },
  anulado: { label: "Anulado", tone: "gray" },
};

export function isExpenseStatus(value: unknown): value is ExpenseStatus {
  return typeof value === "string" && (EXPENSE_STATUS_KEYS as readonly string[]).includes(value);
}

export function expenseStatusLabel(status: string): string {
  return isExpenseStatus(status) ? EXPENSE_STATUSES[status].label : status;
}

/** Programado si la fecha es hoy o futura; vencido si ya pasó. La regla de alta, edición, revertir y del trabajo diario. */
export function unpaidStatusFor(scheduledDate: CivilDate, todayLocal: CivilDate): "programado" | "vencido" {
  return scheduledDate < todayLocal ? "vencido" : "programado";
}

export type ExpenseAction = "confirm_amount" | "edit_date" | "reschedule" | "pay" | "void" | "revert";

export const EXPENSE_ACTION_LABELS: Record<ExpenseAction, string> = {
  confirm_amount: "Confirmar monto",
  edit_date: "Editar fecha",
  reschedule: "Reprogramar",
  pay: "Pagar",
  void: "Anular",
  revert: "Revertir pago",
};

/**
 * Qué acciones ofrece la ficha según el estado. Un pagado no se anula directo: se revierte y después se
 * anula (así queda en el historial que se pagó y se deshizo). El job solo pasa Programado → Vencido.
 */
export function allowedTransitions(expense: { status: string }): ExpenseAction[] {
  switch (expense.status) {
    case "por_revisar":
      return ["confirm_amount", "pay", "void"];
    case "programado":
      return ["edit_date", "pay", "void"];
    case "vencido":
      return ["reschedule", "pay", "void"];
    case "pagado":
      return ["revert"];
    default:
      return [];
  }
}

export const EXPENSE_ORIGINS = ["manual", "recurring", "processor_fee", "meta_ads", "adjustment", "commission_payout"] as const;
export type ExpenseOrigin = (typeof EXPENSE_ORIGINS)[number];

export const EXPENSE_ORIGIN_LABELS: Record<ExpenseOrigin, string> = {
  manual: "Manual",
  recurring: "Recurrente",
  processor_fee: "Comisión de procesador",
  meta_ads: "Pauta de Meta",
  adjustment: "Ajuste",
  commission_payout: "Liquidación de comisiones",
};

export function expenseOriginLabel(origin: string): string {
  return (EXPENSE_ORIGIN_LABELS as Record<string, string>)[origin] ?? origin;
}

/** Los automáticos que recalcula el sistema todos los días mientras no estén pagados. */
export function isAutoOrigin(origin: string): boolean {
  return origin === "processor_fee" || origin === "meta_ads";
}
