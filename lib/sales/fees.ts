/**
 * Comisión del proveedor (plano F7). Portado de `calculateProviderFee` de
 * prevxcrm, pero en céntimos enteros: `round(céntimos × pct / 100) + fijo`.
 *
 * El porcentaje se pasa a puntos básicos enteros para que ni el 2,9 % entre
 * como flotante a la multiplicación.
 */
import { fromCents, num, toCents } from "@/lib/shared/money";
import { findMethod, type PaymentMethodDef } from "./payment-methods";

export interface FeeSpec {
  pct: number;
  fixed: number;
}

export interface PaymentOptionSnapshot {
  method_key: string;
  method_name: string;
  provider_fee_percent: number;
  provider_fee_fixed: number;
}

/**
 * `catalog` es la lista de métodos DEL NEGOCIO (`workspaces.payment_methods`). Sin ella se usa el catálogo
 * de arranque, que es lo que hacían todos los llamadores antes de que los métodos fueran configurables.
 */
function specOf(method: string | FeeSpec | PaymentMethodDef | null | undefined, catalog?: readonly PaymentMethodDef[]): FeeSpec {
  if (!method) return { pct: 0, fixed: 0 };
  if (typeof method === "string") {
    const def = findMethod(catalog, method);
    return { pct: def?.feePercent ?? 0, fixed: def?.feeFixed ?? 0 };
  }
  if ("feePercent" in method) return { pct: method.feePercent, fixed: method.feeFixed };
  return { pct: method.pct, fixed: method.fixed };
}

/**
 * Comisión en céntimos: `round(céntimos × pct / 100) + fijo`, SIN pasarse del monto (un procesador no
 * se puede quedar con más de lo que entró). El porcentaje con hasta 3 decimales entra en milésimas
 * enteras, así `2,125 %` no pasa por el flotante.
 */
export function providerFeeCents(amountCents: number, spec: FeeSpec): number {
  if (!(amountCents > 0)) return 0;
  const thousandths = Math.round(num(spec.pct) * 1000);
  const fee = Math.round((amountCents * thousandths) / 100_000) + toCents(spec.fixed);
  return Math.min(fee, amountCents);
}

/** Comisión en dólares, redondeada al céntimo. */
export function computeProviderFee(
  amount: unknown,
  method: string | FeeSpec | PaymentMethodDef | null | undefined,
  catalog?: readonly PaymentMethodDef[],
): number {
  return fromCents(providerFeeCents(toCents(amount), specOf(method, catalog)));
}

export interface FeeBreakdown {
  /** Lo que cobra el porcentaje, en céntimos. */
  feePercentCents: number;
  /** El fijo, en céntimos (ya recortado si el monto no alcanza). */
  feeFixedCents: number;
  /** Total que se queda el procesador, en céntimos. */
  feeTotal: number;
  /** Lo que entra: cobrado menos comisión, en céntimos. */
  net: number;
}

/** Cobrado → comisión y neto, todo en céntimos. */
export function feeBreakdown(amount: unknown, spec: FeeSpec): FeeBreakdown {
  const cents = toCents(amount);
  if (!(cents > 0)) return { feePercentCents: 0, feeFixedCents: 0, feeTotal: 0, net: 0 };
  const pctCents = Math.round((cents * Math.round(num(spec.pct) * 1000)) / 100_000);
  const total = providerFeeCents(cents, spec);
  const percentPart = Math.min(pctCents, total);
  return { feePercentCents: percentPart, feeFixedCents: total - percentPart, feeTotal: total, net: cents - total };
}

/** La foto del método al cobrar (`payments.payment_option_snapshot`). */
export function buildPaymentOptionSnapshot(methodKey: string, catalog?: readonly PaymentMethodDef[]): PaymentOptionSnapshot | null {
  const def = findMethod(catalog, methodKey);
  if (!def) return null;
  return {
    method_key: def.key,
    method_name: def.name,
    provider_fee_percent: def.feePercent,
    provider_fee_fixed: def.feeFixed,
  };
}
