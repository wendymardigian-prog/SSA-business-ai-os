/**
 * El paso 1 del asistente de venta (plano F18): contacto, asignaciones, atribución y
 * datos de la venta. Reglas puras; el componente solo compone. El borrador vive en el
 * cliente: no se escribe nada hasta guardar.
 */
import type { AttributionFieldState } from "../attribution-field";
import { isDateOnly } from "../dates";
import { INACTIVE_SALE_STATUSES } from "../labels";

export interface Step1State {
  contactId: string | null;
  setterId: string | null;
  vendedorId: string | null;
  attribution: AttributionFieldState;
  saleDate: string;
  notes: string;
  bookingId: string | null;
}

export interface Step1Context {
  /** Hoy en la zona del workspace (YYYY-MM-DD). */
  today: string;
  /** Cuántos toques tiene el contacto (para el tipo del borrador). */
  touchCount: number;
  doNotContact: boolean;
  /** Pagos morosos del contacto. */
  overduePayments: number;
}

export type Step1Warning = { kind: "do_not_contact" | "overdue_payments"; text: string };

export interface Step1Result {
  /** "Siguiente" habilitado. */
  canAdvance: boolean;
  errors: Array<{ field: "contact" | "saleDate"; message: string }>;
  /** No bloquean: se muestran arriba. */
  warnings: Step1Warning[];
}

export function validateStep1(state: Step1State, ctx: Step1Context): Step1Result {
  const errors: Step1Result["errors"] = [];
  if (!state.contactId) errors.push({ field: "contact", message: "Elegí el contacto de la venta" });
  if (!isDateOnly(state.saleDate)) errors.push({ field: "saleDate", message: "La fecha de la venta no es válida" });
  else if (state.saleDate > ctx.today) errors.push({ field: "saleDate", message: "La fecha de la venta no puede ser futura" });

  const warnings: Step1Warning[] = [];
  if (ctx.doNotContact) warnings.push({ kind: "do_not_contact", text: "Este contacto está marcado como «no contactar»." });
  if (ctx.overduePayments > 0) warnings.push({ kind: "overdue_payments", text: `Este contacto tiene ${ctx.overduePayments} ${ctx.overduePayments === 1 ? "pago moroso" : "pagos morosos"}.` });

  // Sin toques NO bloquea: la venta queda "Sin atribución".
  return { canAdvance: errors.length === 0, errors, warnings };
}

/** El tipo con el que va a quedar el borrador: sin toques y sin edición, `none`. */
export function draftAttributionType(state: AttributionFieldState, touchCount: number): "last_touch" | "manual" | "none" {
  if (state.mode === "touch" || state.mode === "manual") return "manual";
  return touchCount > 0 ? "last_touch" : "none";
}

export interface ContactSaleRef {
  id: string;
  status: string;
  productId: string | null;
}

/** Las ventas activas (no canceladas ni reembolsadas) del contacto con ese producto: el aviso de venta duplicada. */
export function activeSalesOfProduct(sales: readonly ContactSaleRef[], productId: string | null): ContactSaleRef[] {
  if (!productId) return [];
  return sales.filter((s) => s.productId === productId && !(INACTIVE_SALE_STATUSES as readonly string[]).includes(s.status));
}
