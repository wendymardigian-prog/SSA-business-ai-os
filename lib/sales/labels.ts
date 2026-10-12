/** Etiquetas en castellano de Ventas (plano §13.0). Una sola fuente para todas las pantallas. */

export const SALE_STATUSES = [
  "pending_payment",
  "reserved",
  "paid",
  "overdue",
  "subscription_active",
  "cancelled",
  "refunded",
  "disputed",
  "subscription_cancelled",
] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const PAYMENT_STATUSES = ["scheduled", "paid", "overdue", "uncollectible", "refunded", "cancelled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_TYPES = ["full", "reservation", "installment", "refund"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const FINANCING_TYPES = ["full", "reservation_balance", "installments", "reservation_installments", "subscription"] as const;
export type FinancingType = (typeof FINANCING_TYPES)[number];

export const ATTRIBUTION_TYPES = ["last_touch", "manual", "none"] as const;
export type AttributionType = (typeof ATTRIBUTION_TYPES)[number];

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  pending_payment: "Con pago pendiente",
  reserved: "Reservada",
  paid: "Pagada",
  overdue: "Con mora",
  subscription_active: "Suscripción activa",
  cancelled: "Cancelada",
  refunded: "Reembolsada",
  disputed: "En disputa",
  subscription_cancelled: "Suscripción cancelada",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  scheduled: "Programado",
  paid: "Cobrado",
  overdue: "Moroso",
  uncollectible: "Incobrable",
  refunded: "Reembolsado",
  cancelled: "Anulado",
};

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  full: "Pago completo",
  reservation: "Reserva",
  installment: "Cuota",
  refund: "Reembolso",
};

export const FINANCING_TYPE_LABELS: Record<FinancingType, string> = {
  full: "Pago completo",
  reservation_balance: "Reserva + saldo",
  installments: "Cuotas",
  reservation_installments: "Reserva + cuotas",
  subscription: "Suscripción",
};

export const ATTRIBUTION_TYPE_LABELS: Record<AttributionType, string> = {
  last_touch: "Último toque",
  manual: "Manual",
  none: "Sin atribución",
};

/** Los estados de venta que cuentan como "activa" para el aviso del mismo producto (F18). */
export const INACTIVE_SALE_STATUSES: readonly SaleStatus[] = ["cancelled", "refunded", "subscription_cancelled"];

export function saleStatusLabel(status: string | null | undefined): string {
  return (SALE_STATUS_LABELS as Record<string, string>)[status ?? ""] ?? (status || "—");
}

export function paymentStatusLabel(status: string | null | undefined): string {
  return (PAYMENT_STATUS_LABELS as Record<string, string>)[status ?? ""] ?? (status || "—");
}

export function paymentTypeLabel(type: string | null | undefined): string {
  return (PAYMENT_TYPE_LABELS as Record<string, string>)[type ?? ""] ?? (type || "—");
}
