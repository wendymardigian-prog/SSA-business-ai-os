/**
 * Dinero en pantalla. La plata se decide siempre en CÉNTIMOS enteros (`lib/shared/money.ts`); acá solo
 * se muestra. Siempre USD, dos decimales, punto de miles y coma decimal ("USD 1.240,00").
 */
const NUMBER = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `124000` → `USD 1.240,00`; un negativo lleva el signo delante: `−USD 4,20`. */
export function formatUsd(cents: number): string {
  const value = Number.isFinite(cents) ? Math.round(cents) : 0;
  const body = NUMBER.format(Math.abs(value) / 100);
  return `${value < 0 ? "−" : ""}USD ${body}`;
}

/** Igual que `formatUsd` pero sin el prefijo (para tablas densas con la moneda en el encabezado). */
export function formatUsdNumber(cents: number): string {
  const value = Number.isFinite(cents) ? Math.round(cents) : 0;
  return `${value < 0 ? "−" : ""}${NUMBER.format(Math.abs(value) / 100)}`;
}
