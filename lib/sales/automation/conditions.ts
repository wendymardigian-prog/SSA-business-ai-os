/**
 * Las condiciones de Ventas para el nodo Condition (plano F37), como funciones puras sobre filas ya
 * leídas. El registro (`lib/flow-engine/registry/sales-conditions.ts`) lee de la base y llama a estas.
 *
 * Sin dato, devuelven vacío («no tiene ninguna venta» no puede decir que el estado de su última venta
 * es «pagada»). Los booleanos devuelven `"true"` / `"false"`, los números, texto.
 */
import { fromCents, toCents, totalPaidCents } from "@/lib/shared/money";
import { INACTIVE_SALE_STATUSES } from "../labels";
import { snapshotProductId } from "../sale-text";

export interface ConditionSale {
  id: string;
  status: string;
  sale_date: string;
  created_at: string;
  product_snapshot: unknown;
  attribution: unknown;
  attribution_type: string;
  booking_id: string | null;
}

export interface ConditionPayment {
  type: string;
  status: string;
  amount: unknown;
  delay_days: number | null;
  sale_id: string;
}

/** La más reciente primero: por fecha de venta y, a igualdad, por creación. */
export function newestFirst<T extends Pick<ConditionSale, "sale_date" | "created_at">>(sales: readonly T[]): T[] {
  return [...sales].sort((a, b) => (a.sale_date === b.sale_date ? Date.parse(b.created_at) - Date.parse(a.created_at) : a.sale_date < b.sale_date ? 1 : -1));
}

/** ¿Tiene una venta activa (de un producto o variante, si se da)? */
export function hasActiveSale(sales: readonly ConditionSale[], argument: string): string {
  const active = sales.filter((s) => !(INACTIVE_SALE_STATUSES as readonly string[]).includes(s.status));
  if (!argument) return String(active.length > 0);
  return String(
    active.some((s) => {
      const snap = (s.product_snapshot ?? {}) as { product_id?: string; variant_id?: string };
      return snap.product_id === argument || snap.variant_id === argument || snapshotProductId(s.product_snapshot) === argument;
    }),
  );
}

export function lastSaleStatus(sales: readonly ConditionSale[]): string {
  return newestFirst(sales)[0]?.status ?? "";
}

export function hasOverduePayments(payments: readonly ConditionPayment[]): string {
  return String(payments.some((p) => p.status === "overdue"));
}

/** Cuántos pagos cobrados llegaron con más de N días de atraso. */
export function latePaymentsCount(payments: readonly ConditionPayment[], daysArgument: string): string {
  const n = Number(daysArgument);
  const threshold = Number.isFinite(n) ? n : 0;
  return String(payments.filter((p) => p.status === "paid" && p.type !== "refund" && p.delay_days != null && p.delay_days > threshold).length);
}

/** El monto total comprado: lo cobrado neto de todas sus ventas (los reembolsos restan), en dólares. */
export function totalPurchased(payments: readonly ConditionPayment[]): string {
  return String(fromCents(toCents(fromCents(totalPaidCents(payments)))));
}

export type UtmKey = "source" | "medium" | "campaign";

export function saleUtm(sale: Pick<ConditionSale, "attribution" | "attribution_type"> | null, key: string): string {
  if (!sale || sale.attribution_type === "none") return "";
  if (key !== "source" && key !== "medium" && key !== "campaign") return "";
  const value = (sale.attribution as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : "";
}

export function saleAttributionType(sale: Pick<ConditionSale, "attribution_type"> | null): string {
  return sale?.attribution_type ?? "";
}

export function saleFromBooking(sale: Pick<ConditionSale, "booking_id"> | null): string {
  return String(!!sale?.booking_id);
}
