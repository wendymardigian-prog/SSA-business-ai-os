/**
 * Plata en céntimos (plano §0.2, §12). Portado de `calculateTotalPaid` /
 * `calculateBalance` de prevxcrm (`src/lib/sales-constants.ts`), que sumaban en
 * flotante: 0.1 + 0.2 dejaba un saldo de 0.0000000000000000555 y una venta
 * saldada quedaba "con pago pendiente".
 *
 * Reglas:
 *  - Ninguna decisión de saldo, cuadre o mora se toma con punto flotante.
 *  - Todo lo que viene de la base pasa por `toCents` / `num` (`Number(x) || 0`).
 *  - Solo USD (decisión del plano): no hay moneda acá.
 */

/** `Number(x) || 0`: nunca NaN, nunca un `undefined` que se propaga. */
export function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Importe en dólares → céntimos enteros. `416.67` → `41667`. */
export function toCents(amount: unknown): number {
  return Math.round(num(amount) * 100);
}

/** Céntimos → importe con dos decimales exactos. */
export function fromCents(cents: number): number {
  return Math.round(num(cents)) / 100;
}

export interface MoneyRow {
  amount: unknown;
  status: string;
}

/** Cobrado neto, en céntimos: los pagos `paid` (los reembolsos son filas `paid` con monto negativo). */
export function totalPaidCents(payments: readonly MoneyRow[] | null | undefined): number {
  let total = 0;
  for (const p of payments ?? []) if (p.status === "paid") total += toCents(p.amount);
  return total;
}

/** Suma de los pagos en los estados dados, en céntimos. */
export function sumCentsByStatus(payments: readonly MoneyRow[] | null | undefined, statuses: readonly string[]): number {
  let total = 0;
  for (const p of payments ?? []) if (statuses.includes(p.status)) total += toCents(p.amount);
  return total;
}

/** Saldo = final − cobrado neto, en céntimos. Marcar incobrable NO lo cambia. */
export function balanceCents(finalAmount: unknown, payments: readonly MoneyRow[] | null | undefined): number {
  return toCents(finalAmount) - totalPaidCents(payments);
}

/** Atajos en dólares (para mostrar). */
export function calculateTotalPaid(payments: readonly MoneyRow[] | null | undefined): number {
  return fromCents(totalPaidCents(payments));
}

export function calculateBalance(finalAmount: unknown, payments: readonly MoneyRow[] | null | undefined): number {
  return fromCents(balanceCents(finalAmount, payments));
}

/** Suma exacta de importes (en dólares) comparada en céntimos. */
export function sumAmounts(amounts: readonly unknown[]): number {
  return fromCents(amounts.reduce<number>((acc, a) => acc + toCents(a), 0));
}
