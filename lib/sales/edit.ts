/**
 * Editar una venta (plano F26): qué se puede tocar según el estado, y qué pasa cuando
 * cambia el precio o el producto con pagos ya cobrados. Puro.
 *
 *  - Una venta cancelada, reembolsada o en disputa solo admite cambiar las notas.
 *  - Cambiar el producto o el precio con pagos cobrados exige `confirmRepricing` y un motivo,
 *    REESCRIBE el snapshot (el anterior queda en `audit_log.changes`) y NO toca lo cobrado.
 *    Si después el cuadre se rompe, `plan_unbalanced = true` y se ofrece «Rearmar el plan».
 */
import { checkDiscount, type Discount, type ProductSnapshot } from "./sale-math";
import { fromCents, toCents, totalPaidCents } from "./money";
import { validatePlanBalances } from "./payment-plan";

export const LOCKED_STATUSES = ["cancelled", "refunded", "disputed"] as const;

export function isLockedForEdit(status: string): boolean {
  return (LOCKED_STATUSES as readonly string[]).includes(status);
}

export const LOCKED_REASON: Record<string, string> = {
  cancelled: "Una venta cancelada no se edita (solo las notas).",
  refunded: "Una venta reembolsada no se edita (solo las notas).",
  disputed: "Una venta en disputa no se edita (solo las notas).",
};

/** Los campos de una edición que NO son notas. */
export type EditField = "contact" | "setter" | "vendedor" | "attribution" | "pricing" | "serviceStartsAt";

export function lockedEditError(status: string, fields: readonly EditField[]): string | null {
  if (!isLockedForEdit(status) || fields.length === 0) return null;
  return LOCKED_REASON[status] ?? "Esta venta no se puede editar.";
}

export interface PricingPayment {
  type: string;
  status: string;
  amount: unknown;
}

export interface PricingSale {
  base_amount: unknown;
  discount_amount: unknown;
  final_amount: unknown;
  discount_reason: string | null;
  product_snapshot: unknown;
  product_version_id: string;
  financing_type: string;
}

export interface PricingChange {
  /** Un producto o una versión nueva (ya releída del catálogo). */
  snapshot?: ProductSnapshot | null;
  versionId?: string | null;
  discount?: Discount;
  /** Si no viene el descuento, se mantiene el actual. */
  discountReason?: string | null;
}

export interface PricingContext {
  maxPercent: number | null;
  hasAllScope: boolean;
  confirmRepricing: boolean;
  repricingReason: string | null;
}

export type PricingResult =
  | {
      ok: true;
      changed: boolean;
      patch: {
        product_snapshot: unknown;
        product_version_id: string;
        base_amount: number;
        discount_amount: number;
        final_amount: number;
        discount_reason: string | null;
      };
      /** Lo anterior, para `audit_log.changes`. */
      previous: { product_snapshot: unknown; base_amount: unknown; discount_amount: unknown; final_amount: unknown; product_version_id: string };
      planUnbalanced: boolean;
      diffCents: number;
      paidCents: number;
    }
  | { ok: false; code: "confirm_required" | "reason_required" | "discount"; error: string; paidCents?: number };

/**
 * Calcula un cambio de precio o de producto. Con pagos cobrados pide la confirmación y el
 * motivo, y dice cuánto se cobró. NO toca lo cobrado: solo recalcula si el plan sigue cuadrando.
 */
export function planRepricing(sale: PricingSale, payments: readonly PricingPayment[], change: PricingChange, ctx: PricingContext): PricingResult {
  const snapshot = (change.snapshot ?? sale.product_snapshot) as { price?: unknown };
  const base = change.snapshot ? Number(change.snapshot.price) || 0 : Number(sale.base_amount) || 0;
  const discount: Discount =
    change.discount !== undefined
      ? change.discount
      : { type: "amount", value: sale.discount_amount };

  const checked = checkDiscount(base, discount, { maxPercent: ctx.maxPercent, reason: change.discountReason ?? sale.discount_reason, hasAllScope: ctx.hasAllScope });
  if (!checked.ok) return { ok: false, code: "discount", error: checked.error };

  const finalAmount = checked.finalAmount;
  const changed =
    toCents(finalAmount) !== toCents(sale.final_amount) ||
    toCents(base) !== toCents(sale.base_amount) ||
    (change.versionId != null && change.versionId !== sale.product_version_id);

  const paidCents = totalPaidCents(payments);
  const live = payments.filter((p) => p.status !== "cancelled" && p.type !== "refund");
  const balance = validatePlanBalances(finalAmount, live);
  const subscription = sale.financing_type === "subscription";

  if (changed && paidCents > 0) {
    if (!ctx.confirmRepricing) {
      return { ok: false, code: "confirm_required", paidCents: fromCents(paidCents), error: `Ya se cobró ${fromCents(paidCents).toFixed(2)}: confirmá el cambio de precio para seguir` };
    }
    if (!(ctx.repricingReason ?? "").trim()) {
      return { ok: false, code: "reason_required", paidCents: fromCents(paidCents), error: "Explicá el motivo del cambio de precio" };
    }
  }
  void snapshot;

  return {
    ok: true,
    changed,
    patch: {
      product_snapshot: change.snapshot ?? sale.product_snapshot,
      product_version_id: change.versionId ?? sale.product_version_id,
      base_amount: base,
      discount_amount: checked.discountAmount,
      final_amount: finalAmount,
      discount_reason: (change.discountReason ?? sale.discount_reason)?.trim() || null,
    },
    previous: {
      product_snapshot: sale.product_snapshot,
      base_amount: sale.base_amount,
      discount_amount: sale.discount_amount,
      final_amount: sale.final_amount,
      product_version_id: sale.product_version_id,
    },
    planUnbalanced: changed && !subscription && !balance.ok,
    diffCents: balance.diffCents,
    paidCents,
  };
}

/** Si dos personas editan a la vez gana el último guardado, con aviso si `updated_at` cambió. */
export function hasEditConflict(expectedUpdatedAt: string | null | undefined, currentUpdatedAt: string): boolean {
  if (!expectedUpdatedAt) return false;
  return Date.parse(expectedUpdatedAt) !== Date.parse(currentUpdatedAt);
}
