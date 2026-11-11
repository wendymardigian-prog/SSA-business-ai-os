/**
 * Los totales del pie de una tabla. PURO.
 *
 * La plata se suma en CÉNTIMOS enteros (nunca en flotante) y un dato que no existe es `null` («—»), nunca 0: un cero se lee
 * después como «ese dato vale cero», que es una afirmación distinta y falsa.
 */
import { fromCents, toCents } from "@/lib/shared/money";

/** Suma montos en dólares. Sin ningún valor, `null`. */
export function sumMoney(values: ReadonlyArray<number | string | null | undefined>): number | null {
  let cents = 0;
  let seen = false;
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    seen = true;
    cents += toCents(value);
  }
  return seen ? fromCents(cents) : null;
}

/** Suma cantidades enteras. Sin ningún valor, `null`. */
export function sumCount(values: ReadonlyArray<number | null | undefined>): number | null {
  let total = 0;
  let seen = false;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    seen = true;
    total += value;
  }
  return seen ? total : null;
}
