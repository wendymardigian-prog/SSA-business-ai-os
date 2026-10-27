/**
 * El paso 3 del asistente (plano F20): financiamiento. El estado del formulario y las reglas
 * que el servidor vuelve a aplicar (`applySaleRules`), para avisar acá antes de guardar. Puro.
 */
import { isDateOnly } from "@/lib/shared/dates";
import type { FinancingType } from "../labels";
import { isKnownMethod, type PaymentMethodDef } from "../payment-methods";
import { bornOverdue, buildPaymentPlan, type Frequency, type PlannedPayment } from "../payment-plan";

export type SubscriptionInterval = "monthly" | "quarterly" | "yearly";

export interface Step3State {
  financing: FinancingType;
  /** Monto del primer pago (reserva, primera cuota o importe del ciclo). En «pago completo» se ignora. */
  firstAmount: string;
  firstPaid: boolean;
  /** Fecha efectiva (si ya se cobró) o vencimiento (si queda programado). */
  firstDate: string;
  firstMethod: string;
  installments: string;
  frequency: Frequency;
  firstDue: string;
  subscriptionInterval: SubscriptionInterval;
}

export function defaultStep3(today: string, financing: FinancingType = "full"): Step3State {
  return {
    financing,
    firstAmount: "",
    firstPaid: financing === "full",
    firstDate: today,
    firstMethod: "",
    installments: "3",
    frequency: "monthly",
    firstDue: today,
    subscriptionInterval: "monthly",
  };
}

/** El plan que propone el sistema desde el formulario; la tabla se puede editar fila por fila después. */
export function planFromState(finalAmount: number, state: Step3State): PlannedPayment[] {
  const plan = buildPaymentPlan({
    total: finalAmount,
    financing: state.financing,
    first: { amount: Number(state.firstAmount) || 0, paid: state.firstPaid, date: state.firstDate, method: state.firstMethod || null },
    installments: Math.max(1, Math.floor(Number(state.installments) || 1)),
    frequency: state.frequency,
    firstDue: state.firstDue,
  });
  // Un pago programado no lleva método hasta que se cobra.
  return plan.map((p) => (p.status === "scheduled" ? { ...p, payment_method: p.payment_method ?? null } : p));
}

export interface RowsCheck {
  errors: string[];
  /** Posiciones de cuotas con vencimiento anterior a hoy: nacen morosas (aviso, no bloquea). */
  bornOverdue: number[];
}

export function checkRows(
  rows: readonly PlannedPayment[],
  ctx: { saleDate: string; today: string; enabledMethods: readonly string[]; methods?: readonly PaymentMethodDef[] },
): RowsCheck {
  const errors: string[] = [];
  rows.forEach((p, i) => {
    const n = i + 1;
    if (!(Number(p.amount) > 0)) errors.push(`El pago ${n} necesita un monto mayor que cero`);
    if (!p.due_date || !isDateOnly(p.due_date)) {
      errors.push(`El pago ${n} necesita una fecha válida`);
      return;
    }
    if (p.status === "paid") {
      if (p.due_date < ctx.saleDate) errors.push(`El pago ${n} no puede estar cobrado antes de la fecha de la venta`);
      if (p.due_date > ctx.today) errors.push(`El pago ${n} está cobrado con una fecha futura`);
      if (!p.payment_method || !isKnownMethod(p.payment_method, ctx.methods)) errors.push(`Elegí el método del pago ${n}, que ya se cobró`);
      else if (!ctx.enabledMethods.includes(p.payment_method)) errors.push(`El método del pago ${n} no está habilitado`);
    }
  });
  return { errors, bornOverdue: bornOverdue(rows, ctx.today) };
}

/** Lo que viaja a `createSale`: la fecha es la efectiva (cobrado) o el vencimiento (programado). */
export function paymentsForServer(rows: readonly PlannedPayment[]) {
  return rows.map((p) => ({
    type: p.type,
    amount: p.amount,
    status: p.status,
    date: p.due_date as string,
    method: p.payment_method ?? null,
  }));
}
