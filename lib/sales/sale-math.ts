/**
 * La matemática de una venta (plano F19, F23), en céntimos. Funciones puras.
 *
 * Portado de `calculateTotalPaid` / `calculateBalance` de prevxcrm
 * (`sales-constants.ts`), que sumaban en flotante.
 */
import { fromCents, sumCentsByStatus, toCents, totalPaidCents, type MoneyRow } from "./money";

export type Discount = { type: "amount"; value: unknown } | { type: "percent"; value: unknown } | null | undefined;

/** El descuento, en céntimos, para un precio base. Un porcentaje se redondea al céntimo. */
export function discountCents(base: unknown, discount: Discount): number {
  if (!discount) return 0;
  const baseCents = toCents(base);
  if (discount.type === "amount") return Math.max(0, toCents(discount.value));
  // porcentaje en puntos básicos enteros: 15 % = 1500 pb.
  const bps = Math.round((Number(discount.value) || 0) * 100);
  return Math.max(0, Math.round((baseCents * bps) / 10000));
}

/** `computeFinalAmount(1497, {type:'amount', value:200})` = 1297; con `{percent, 15}` = 1272.45. */
export function computeFinalAmount(base: unknown, discount: Discount): number {
  return fromCents(toCents(base) - discountCents(base, discount));
}

export type DiscountCheck = { ok: true; discountAmount: number; finalAmount: number } | { ok: false; error: string; code: "negative" | "over_cap" | "reason_required" | "needs_scope" };

/**
 * Valida el descuento:
 *  - no puede dejar el final negativo;
 *  - sobre el tope del workspace (`max_discount_percent`) pide un motivo Y alcance `all`
 *    (quien carga con alcance `own` no puede pasarse del tope, aunque el cliente lo mande).
 */
export function checkDiscount(
  base: unknown,
  discount: Discount,
  options: { maxPercent?: number | null; reason?: string | null; hasAllScope: boolean },
): DiscountCheck {
  const baseCents = toCents(base);
  const cents = discountCents(base, discount);
  if (cents > baseCents) return { ok: false, code: "negative", error: "El descuento no puede ser mayor que el precio" };

  const cap = options.maxPercent;
  if (cap != null && Number.isFinite(Number(cap)) && baseCents > 0) {
    const capBps = Math.round(Number(cap) * 100);
    const over = cents * 10000 > baseCents * capBps;
    if (over) {
      if (!options.hasAllScope) return { ok: false, code: "needs_scope", error: `El descuento supera el tope de ${cap} %: lo tiene que cargar alguien con alcance «todas las ventas»` };
      if (!(options.reason ?? "").trim()) return { ok: false, code: "reason_required", error: `El descuento supera el tope de ${cap} %: explicá el motivo` };
    }
  }
  return { ok: true, discountAmount: fromCents(cents), finalAmount: fromCents(baseCents - cents) };
}

export interface SnapshotProduct {
  id: string;
  name: string;
  product_type: string;
}
export interface SnapshotVariant {
  id: string;
  name: string;
  duration_type: string;
  duration_value: number | null;
  billing_type: string;
  billing_interval: string | null;
  guarantee_duration_type: string | null;
  guarantee_duration_value: number | null;
  /** El precio de la variante en este momento (USD). */
  price: unknown;
}

export interface ProductSnapshot {
  product_id: string;
  product_name: string;
  product_type: string;
  variant_id: string;
  variant_name: string;
  price: number;
  currency: "USD";
  duration_type: string;
  duration_value: number | null;
  billing_type: string;
  billing_interval: string | null;
  guarantee_duration_type: string | null;
  guarantee_duration_value: number | null;
}

/** La foto del producto al vender: la venta conserva su precio aunque el catálogo cambie. */
export function buildProductSnapshot(product: SnapshotProduct, variant: SnapshotVariant): ProductSnapshot {
  return {
    product_id: product.id,
    product_name: product.name,
    product_type: product.product_type,
    variant_id: variant.id,
    variant_name: variant.name,
    price: fromCents(toCents(variant.price)),
    currency: "USD",
    duration_type: variant.duration_type,
    duration_value: variant.duration_value,
    billing_type: variant.billing_type,
    billing_interval: variant.billing_interval,
    guarantee_duration_type: variant.guarantee_duration_type,
    guarantee_duration_value: variant.guarantee_duration_value,
  };
}

/**
 * Saldo = final − Σ pagos cobrados (los reembolsos son filas cobradas con monto
 * negativo, así que restan solos), en céntimos. Marcar incobrable NO lo cambia.
 */
export function saleBalance(finalAmount: unknown, payments: readonly MoneyRow[] | null | undefined): number {
  return fromCents(toCents(finalAmount) - totalPaidCents(payments));
}

/** Lo que falta por cobrar: los programados y los morosos. Los incobrables y anulados no entran. */
export function saleExpected(payments: readonly MoneyRow[] | null | undefined): number {
  return fromCents(sumCentsByStatus(payments, ["scheduled", "overdue"]));
}

/** Cobrado neto (con los reembolsos ya restados). */
export function salePaid(payments: readonly MoneyRow[] | null | undefined): number {
  return fromCents(totalPaidCents(payments));
}
