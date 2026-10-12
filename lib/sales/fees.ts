/**
 * Comisión del proveedor (plano F7). Portado de `calculateProviderFee` de
 * prevxcrm, pero en céntimos enteros: `round(céntimos × pct / 100) + fijo`.
 *
 * El porcentaje se pasa a puntos básicos enteros para que ni el 2,9 % entre
 * como flotante a la multiplicación.
 */
import { fromCents, num, toCents } from "./money";
import { paymentMethod, type PaymentMethodDef } from "./payment-methods";

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

function specOf(method: string | FeeSpec | PaymentMethodDef | null | undefined): FeeSpec {
  if (!method) return { pct: 0, fixed: 0 };
  if (typeof method === "string") {
    const def = paymentMethod(method);
    return { pct: def?.feePercent ?? 0, fixed: def?.feeFixed ?? 0 };
  }
  if ("feePercent" in method) return { pct: method.feePercent, fixed: method.feeFixed };
  return { pct: method.pct, fixed: method.fixed };
}

/** Comisión en dólares, redondeada al céntimo. */
export function computeProviderFee(amount: unknown, method: string | FeeSpec | PaymentMethodDef | null | undefined): number {
  const { pct, fixed } = specOf(method);
  const cents = toCents(amount);
  if (cents <= 0) return 0;
  const basisPoints = Math.round(num(pct) * 100);
  return fromCents(Math.round((cents * basisPoints) / 10000) + toCents(fixed));
}

/** La foto del método al cobrar (`payments.payment_option_snapshot`). */
export function buildPaymentOptionSnapshot(methodKey: string): PaymentOptionSnapshot | null {
  const def = paymentMethod(methodKey);
  if (!def) return null;
  return {
    method_key: def.key,
    method_name: def.name,
    provider_fee_percent: def.feePercent,
    provider_fee_fixed: def.feeFixed,
  };
}
