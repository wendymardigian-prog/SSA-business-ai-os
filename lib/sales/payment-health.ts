/**
 * La salud de pago de un contacto (plano F31): cómo paga. Se guarda en
 * `contacts.payment_health` y se recalcula al cobrar, revertir o pasar a moroso. Puro.
 */
import { toCents } from "@/lib/shared/money";

export interface HealthPayment {
  type: string;
  status: string;
  amount: unknown;
  delay_days: number | null;
}

export interface PaymentHealth {
  /** Cobrados el día del vencimiento. */
  on_time: number;
  /** Cobrados después. */
  late: number;
  /** Cobrados antes. */
  early: number;
  /** Promedio de desfase de TODOS los cobrados, a un decimal. */
  avg_delay_days: number;
  has_active_overdue: boolean;
  /** Cuántos pagos cobrados cuentan (los reembolsos no). */
  total_paid: number;
}

export const EMPTY_HEALTH: PaymentHealth = { on_time: 0, late: 0, early: 0, avg_delay_days: 0, has_active_overdue: false, total_paid: 0 };

export function computePaymentHealth(payments: readonly HealthPayment[]): PaymentHealth {
  const paid = payments.filter((p) => p.status === "paid" && p.type !== "refund" && toCents(p.amount) > 0 && p.delay_days != null);
  const delays = paid.map((p) => p.delay_days as number);
  const avg = delays.length ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10 : 0;
  return {
    on_time: delays.filter((d) => d === 0).length,
    late: delays.filter((d) => d > 0).length,
    early: delays.filter((d) => d < 0).length,
    avg_delay_days: avg,
    has_active_overdue: payments.some((p) => p.status === "overdue"),
    total_paid: paid.length,
  };
}

/** Lo que se lee en la ficha del contacto: «7 pagos: 5 puntuales, 2 tarde · promedio +3 días · sin mora activa». */
export function describePaymentHealth(health: Partial<PaymentHealth> | null | undefined): string | null {
  const h = { ...EMPTY_HEALTH, ...(health ?? {}) };
  if (h.total_paid === 0 && !h.has_active_overdue) return null;
  const parts: string[] = [];
  if (h.total_paid > 0) {
    const detail = [h.on_time ? `${h.on_time} ${h.on_time === 1 ? "puntual" : "puntuales"}` : null, h.late ? `${h.late} tarde` : null, h.early ? `${h.early} ${h.early === 1 ? "adelantado" : "adelantados"}` : null].filter(Boolean).join(", ");
    parts.push(`${h.total_paid} ${h.total_paid === 1 ? "pago" : "pagos"}${detail ? `: ${detail}` : ""}`);
    const sign = h.avg_delay_days > 0 ? "+" : h.avg_delay_days < 0 ? "−" : "";
    parts.push(`promedio ${sign}${Math.abs(h.avg_delay_days)} ${Math.abs(h.avg_delay_days) === 1 ? "día" : "días"}`);
  }
  parts.push(h.has_active_overdue ? "con mora activa" : "sin mora activa");
  return parts.join(" · ");
}
