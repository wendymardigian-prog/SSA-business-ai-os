/**
 * Ajuste manual de comisiones y sugerencia por reembolso (F64). Puro.
 *
 * Un ajuste (`kind = 'adjustment'`) puede ser negativo y no tiene regla. Es el camino para un reembolso: en la
 * ficha de un pago reembolsado, «Ajustar comisiones de este reembolso» abre el ajuste con la venta cargada y
 * una sugerencia por persona, editable. **No se crea nada solo.**
 */
import { z } from "zod";
import { toCents } from "@/lib/shared/money";

export const ADJUSTMENT_NOTES_MAX = 500;
export const ADJUSTMENT_MAX_AMOUNT = 9_999_999_999.99;

/** El ajuste que carga la persona (camelCase, monto en dólares). */
export const commissionAdjustmentSchema = z
  .strictObject({
    userId: z.uuid("Elegí a quién va el ajuste"),
    /** Dólares, distinto de cero; negativo resta. */
    amount: z
      .number("Poné el monto")
      .refine((n) => Number.isFinite(n) && toCents(n) !== 0, "El monto no puede ser 0")
      .refine((n) => Math.abs(n) <= ADJUSTMENT_MAX_AMOUNT, "El monto es demasiado grande")
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "El monto admite hasta 2 decimales"),
    notes: z.string().trim().min(1, "Contá el motivo del ajuste").max(ADJUSTMENT_NOTES_MAX, `El motivo puede tener hasta ${ADJUSTMENT_NOTES_MAX} caracteres`),
    saleId: z.uuid().nullish(),
    paymentId: z.uuid().nullish(),
    /** Clave del rol (opcional). */
    role: z.string().regex(/^[a-z0-9_]{2,40}$/, "El rol no es válido").nullish(),
  })
  .transform((v) => ({
    userId: v.userId,
    amount: v.amount,
    amountCents: toCents(v.amount),
    notes: v.notes,
    saleId: v.saleId ?? null,
    paymentId: v.paymentId ?? null,
    role: v.role ?? null,
  }));

export type CommissionAdjustmentInput = z.output<typeof commissionAdjustmentSchema>;

/**
 * La sugerencia de ajuste por un reembolso, en céntimos: `−(comisión original × reembolsado / cobrado)`,
 * redondeada al centavo (medio sube en valor absoluto). Un reembolso del 50 % de una comisión de 38,82 sugiere
 * −19,41. Sin cobro, o con una comisión de cero, no hay nada que sugerir (0). Nunca pasa de la comisión
 * original: un reembolso mayor al cobrado se topa en el 100 %.
 *
 * Todos los montos en céntimos y positivos (`refundedCents` es el valor absoluto de la fila `refund`).
 */
export function refundSuggestion(originalCommissionCents: number, refundedCents: number, paidCents: number): number {
  const original = Math.round(Number(originalCommissionCents) || 0);
  const refunded = Math.abs(Math.round(Number(refundedCents) || 0));
  const paid = Math.abs(Math.round(Number(paidCents) || 0));
  if (original <= 0 || refunded === 0 || paid === 0) return 0;
  const ratioNumerator = Math.min(refunded, paid);
  // original × reembolsado / cobrado con enteros: (2·n + d) / (2·d) redondea medio hacia arriba.
  const n = original * ratioNumerator;
  const twice = n * 2 + paid;
  const rounded = (twice - (twice % (2 * paid))) / (2 * paid);
  return rounded === 0 ? 0 : -rounded;
}
