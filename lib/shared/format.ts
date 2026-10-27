/** Formato de dinero: una sola función para todas las pantallas. */
import { toCents } from "./money";

/**
 * `$1.297,00` (punto de miles, coma decimal, como pide el plano). Los
 * negativos (reembolsos) salen entre paréntesis: `($250,00)`. Siempre USD.
 * Se arma a mano: `Intl` con es-CR da "USD 1 297,00".
 */
export function formatMoney(amount: unknown): string {
  const cents = toCents(amount);
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const decimals = String(abs % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const text = `$${grouped},${decimals}`;
  return cents < 0 ? `(${text})` : text;
}

/** El formato sin símbolo ni separadores, para campos de texto: `1297.33`. */
export function formatAmount(amount: unknown): string {
  return (toCents(amount) / 100).toFixed(2);
}
