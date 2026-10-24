/**
 * El inicio del servicio de una venta nueva, según el tipo del producto (00263). Puro.
 *  - duración (programa, mentoría, curso, servicio): la fecha de compra de ese cliente;
 *  - evento: la fecha fija de la variante;
 *  - producto: no tiene inicio.
 * Lo que la persona escribe a mano gana, salvo en un producto.
 */
import type { VariantTiming } from "@/lib/sales/catalog/products";

export function defaultServiceStart(timing: VariantTiming, eventDate: string | null, saleDate: string): string | null {
  if (timing === "none") return null;
  if (timing === "event") return eventDate || saleDate;
  return saleDate;
}

export function resolveServiceStart(typed: string, timing: VariantTiming, eventDate: string | null, saleDate: string): string | null {
  if (timing === "none") return null;
  return typed || defaultServiceStart(timing, eventDate, saleDate);
}

/** La ayuda debajo del campo. */
export function serviceStartHint(timing: VariantTiming): string {
  return timing === "event" ? "Por defecto, la fecha del evento" : "Por defecto, la fecha de la venta";
}
