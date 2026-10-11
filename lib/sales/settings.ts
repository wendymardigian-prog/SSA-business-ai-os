/**
 * Ajustes de Ventas del workspace (plano §13.4): reglas puras de validación.
 * La pantalla (Ajustes > General > Ventas) y la Server Action usan lo mismo.
 */
import { PAYMENT_METHOD_KEYS, isPaymentMethodKey, type PaymentMethodKey } from "./payment-methods";

export type EnabledMethodsCheck = { ok: true; methods: PaymentMethodKey[] } | { ok: false; error: string };

/** Quedan solo métodos que existen, sin repetir y en el orden de la lista; al menos uno. */
export function checkEnabledMethods(input: unknown): EnabledMethodsCheck {
  if (!Array.isArray(input)) return { ok: false, error: "Los métodos de pago no son válidos" };
  if (input.some((m) => !isPaymentMethodKey(m))) return { ok: false, error: "Hay un método de pago que no existe" };
  const wanted = new Set(input as string[]);
  const methods = PAYMENT_METHOD_KEYS.filter((k) => wanted.has(k));
  if (methods.length === 0) return { ok: false, error: "Dejá al menos un método de pago habilitado" };
  return { ok: true, methods };
}
