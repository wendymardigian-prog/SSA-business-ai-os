/**
 * Los métodos de pago (plano F7): una lista fija en código, no una tabla.
 * Cinco filas que no cambian; el snapshot del pago conserva la historia.
 *
 * El CHECK de `payments.payment_method` (00162) sale de esta misma lista y un
 * test lee la migración para comprobar la paridad.
 */

export interface PaymentMethodDef {
  key: string;
  name: string;
  /** Comisión porcentual del proveedor (0–100). */
  feePercent: number;
  /** Comisión fija en USD. */
  feeFixed: number;
}

/**
 * COMISIÓN DE WHOP: 0 % hasta que Wendy confirme el valor real (decisión del
 * 11/10/2026). El plano proponía 3 % como valor de arranque. Mientras la
 * integración de Whop está en pausa, `whop` es un método más que se registra a
 * mano. Cambiar el número NO reescribe lo ya cobrado: el pago guarda su
 * `payment_option_snapshot` y su `provider_fee_amount` al cobrar.
 */
export const PAYMENT_METHODS = [
  { key: "whop", name: "Whop (registrado a mano)", feePercent: 0, feeFixed: 0 },
  { key: "transferencia_cr", name: "Transferencia CR", feePercent: 0, feeFixed: 0 },
  { key: "transferencia_usa", name: "Transferencia USA", feePercent: 0, feeFixed: 0 },
  { key: "wise", name: "Wise", feePercent: 0, feeFixed: 0 },
  { key: "binance", name: "Binance", feePercent: 0, feeFixed: 0 },
] as const satisfies readonly PaymentMethodDef[];

export type PaymentMethodKey = (typeof PAYMENT_METHODS)[number]["key"];

export const PAYMENT_METHOD_KEYS: PaymentMethodKey[] = PAYMENT_METHODS.map((m) => m.key);

/** Lo que trae un workspace nuevo (`workspaces.enabled_payment_methods`, 00159). */
export const DEFAULT_ENABLED_PAYMENT_METHODS: PaymentMethodKey[] = [...PAYMENT_METHOD_KEYS];

export function isPaymentMethodKey(value: unknown): value is PaymentMethodKey {
  return typeof value === "string" && (PAYMENT_METHOD_KEYS as string[]).includes(value);
}

export function paymentMethod(key: string | null | undefined): PaymentMethodDef | null {
  return PAYMENT_METHODS.find((m) => m.key === key) ?? null;
}

/** El nombre legible; una clave que ya no existe se muestra tal cual. */
export function paymentMethodName(key: string | null | undefined): string {
  if (!key) return "—";
  return paymentMethod(key)?.name ?? key;
}

/**
 * Qué métodos ofrece el selector: los habilitados del workspace. Un pago que
 * ya usa un método deshabilitado lo sigue mostrando (se agrega con `keep`).
 */
export function selectableMethods(enabled: readonly string[] | null | undefined, keep?: string | null): PaymentMethodDef[] {
  const on = new Set((enabled ?? DEFAULT_ENABLED_PAYMENT_METHODS) as string[]);
  if (keep) on.add(keep);
  return PAYMENT_METHODS.filter((m) => on.has(m.key));
}

/** Cuántos pagos programados usan un método deshabilitado (el aviso de Ajustes). */
export function scheduledUsingDisabled(
  scheduledMethods: ReadonlyArray<string | null>,
  enabled: readonly string[],
): Record<string, number> {
  const on = new Set(enabled);
  const out: Record<string, number> = {};
  for (const m of scheduledMethods) {
    if (!m || on.has(m)) continue;
    out[m] = (out[m] ?? 0) + 1;
  }
  return out;
}
