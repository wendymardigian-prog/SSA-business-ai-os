/**
 * Solo para tests: el valor de `workspaces.payment_methods` con SOLO los métodos pedidos activos
 * (el resto sigue en la lista, desactivado, como en un negocio real).
 */
import { starterPaymentMethods, type PaymentMethodConfig } from "../payment-methods-config";

export function paymentMethodsFixture(
  active: readonly string[],
  overrides: Record<string, Partial<Pick<PaymentMethodConfig, "fee_percent" | "fee_fixed" | "name">>> = {},
): PaymentMethodConfig[] {
  return starterPaymentMethods().map((m) => ({ ...m, ...(overrides[m.key] ?? {}), active: active.includes(m.key) }));
}
