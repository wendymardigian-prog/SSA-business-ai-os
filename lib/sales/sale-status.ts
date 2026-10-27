/**
 * El estado derivado de una venta (plano F23). Espejo de `derive_sale_status`
 * (00162): los mismos casos (`sale-status.cases.json`) corren contra las dos.
 *
 * Los 4 estados ESCRITOS ganan y no se derivan: cancelled, refunded, disputed,
 * subscription_cancelled. Los 5 derivados, por precedencia:
 *   1. subscription_active  si es suscripción
 *   2. overdue              si hay al menos un pago moroso
 *   3. paid                 si el saldo (final − cobrado neto) ≤ 0, EN CÉNTIMOS
 *   4. reserved             si hay una reserva cobrada y queda saldo
 *   5. pending_payment
 * Un incobrable NO baja el saldo: una venta con un incobrable nunca llega a paid.
 *
 * Estructura de `deriveSaleStatus` de prevxcrm (`sales-constants.ts`), con la
 * precedencia de este plano y sin el estado calculado con flotantes.
 */
import { balanceCents } from "@/lib/shared/money";
import type { SaleStatus } from "./labels";

export const WRITTEN_SALE_STATUSES: readonly SaleStatus[] = ["cancelled", "refunded", "disputed", "subscription_cancelled"];

export interface StatusPayment {
  type: string;
  status: string;
  amount: unknown;
}

export interface StatusSale {
  status?: string | null;
  financing_type: string;
  final_amount: unknown;
}

export function deriveSaleStatus(sale: StatusSale, payments: readonly StatusPayment[] | null | undefined): SaleStatus {
  const current = sale.status ?? null;
  if (current && (WRITTEN_SALE_STATUSES as readonly string[]).includes(current)) return current as SaleStatus;

  if (sale.financing_type === "subscription") return "subscription_active";

  const list = payments ?? [];
  if (list.some((p) => p.status === "overdue")) return "overdue";
  if (balanceCents(sale.final_amount, list) <= 0) return "paid";
  if (list.some((p) => p.type === "reservation" && p.status === "paid")) return "reserved";
  return "pending_payment";
}
