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

export type NumberCheck<T> = { ok: true; value: T } | { ok: false; error: string };

/** El tope de descuento: vacío = sin tope; si no, un número de 0 a 100 (se guarda con hasta dos decimales). */
export function checkMaxDiscountPercent(input: unknown): NumberCheck<number | null> {
  if (input === null || input === undefined || input === "") return { ok: true, value: null };
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: "El tope de descuento tiene que ser un porcentaje de 0 a 100" };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** Los días de gracia antes de pasar un pago a moroso: entero de 0 a 60. */
export function checkGraceDays(input: unknown): NumberCheck<number> {
  const n = Number(input);
  if (input === "" || input === null || input === undefined || !Number.isInteger(n) || n < 0 || n > 60) {
    return { ok: false, error: "Los días de gracia tienen que ser un número entero de 0 a 60" };
  }
  return { ok: true, value: n };
}
