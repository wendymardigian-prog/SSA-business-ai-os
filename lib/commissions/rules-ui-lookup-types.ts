/**
 * Lo que devuelven los buscadores del editor de reglas (`lib/actions/commission-rules-lookup.ts`). Van acá y no en
 * el archivo `"use server"` porque un archivo de acciones solo puede exportar funciones asincrónicas.
 */

/** Una venta para «Probar con una venta». */
export interface SaleTestOption {
  id: string;
  contactName: string;
  productText: string;
  /** Céntimos. */
  finalCents: number;
  status: string;
  saleDate: string;
}

/** Un pago de esa venta que se puede probar. */
export interface SalePaymentOption {
  id: string;
  type: string;
  status: string;
  /** Céntimos. */
  amountCents: number;
  paidOn: string | null;
  dueDate: string | null;
  method: string | null;
}

export type SalePaymentsResult = { ok: true; payments: SalePaymentOption[] } | { ok: false; error: string };

export interface PieceHit {
  id: string;
  title: string;
  code: string | null;
}

export interface MetaHit {
  /** El id de Meta (`campaign_id` o `ad_id`). */
  id: string;
  name: string | null;
  /** «Campaña · Conjunto» de un anuncio, si se conoce. */
  hint: string | null;
}
