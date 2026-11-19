/**
 * Qué se puede hacer con un pago desde el Estado de la tabla de Pagos (18/11/2026). Puro y alineado con las reglas de
 * `payments-rules.ts` (que el servidor vuelve a aplicar): cada opción ABRE el diálogo de siempre, que pide lo que hace
 * falta (fecha y método para cobrar, motivo para incobrable o revertir). No hay atajos que se salteen esos datos.
 */

export type PaymentStatusAction = "paid" | "uncollectible" | "revert";

export interface PaymentStatusMenuOption {
  action: PaymentStatusAction;
  label: string;
}

const LABELS: Record<PaymentStatusAction, string> = {
  paid: "Cobrado…",
  uncollectible: "Incobrable…",
  revert: "Revertir el cobro…",
};

export function paymentStatusMenu(payment: { status: string; isRefund: boolean }, canManage: boolean): PaymentStatusMenuOption[] {
  if (!canManage || payment.isRefund) return [];
  const actions: PaymentStatusAction[] =
    payment.status === "scheduled"
      ? ["paid"]
      : payment.status === "overdue"
        ? ["paid", "uncollectible"]
        : payment.status === "paid" || payment.status === "uncollectible"
          ? ["revert"]
          : [];
  return actions.map((action) => ({ action, label: action === "revert" && payment.status === "uncollectible" ? "Volver a poner en cobro…" : LABELS[action] }));
}
