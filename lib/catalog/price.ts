/**
 * El precio de una variante (Ventas, 00169). Vive en `product_variants.price`, en USD.
 * Cero significa "sin precio": la variante existe pero no se puede vender. Cada cambio
 * queda en `audit_log` (`variant.price_changed`, lo escribe la base: 00170).
 */
import { toCents } from "../sales/money";

export const MAX_PRICE = 10_000_000;

export type PriceCheck = { ok: true; price: number } | { ok: false; error: string };

/** Precio >= 0 (coma o punto), a dos decimales. */
export function checkPrice(raw: unknown): PriceCheck {
  const text = typeof raw === "string" ? raw.trim().replace(",", ".") : raw;
  if (text === "" || text === null || text === undefined) return { ok: false, error: "Poné el precio en dólares" };
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, error: "El precio tiene que ser un número" };
  if (n < 0) return { ok: false, error: "El precio no puede ser negativo" };
  if (n > MAX_PRICE) return { ok: false, error: "Ese precio es demasiado alto" };
  return { ok: true, price: toCents(n) / 100 };
}

/** ¿Tiene precio? Cero (o nada) = sin precio: no se ofrece en una venta nueva. */
export function hasPrice(price: unknown): boolean {
  return toCents(Number(price) || 0) > 0;
}

/** El precio de la columna como número, o null si la variante no tiene precio. */
export function priceOrNull(price: unknown): number | null {
  return hasPrice(price) ? toCents(Number(price)) / 100 : null;
}
