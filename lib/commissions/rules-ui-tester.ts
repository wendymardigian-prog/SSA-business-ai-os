/**
 * «Probar con una venta»: lo que se elige y lo que se manda (F58). Puro.
 */
import { formatUsd } from "@/lib/finance/format";
import { PAYMENT_STATUS_LABELS, PAYMENT_TYPE_LABELS, SALE_STATUS_LABELS } from "@/lib/sales/labels";
import { usdTextToCents } from "./rules-ui-draft";
import { shortCivil } from "./status";
import type { SalePaymentOption, SaleTestOption } from "./rules-ui-lookup-types";

/** Hasta dónde se acepta un cobro hipotético (el servidor admite 99.999.999.999 céntimos). */
export const MAX_TEST_CENTS = 99_999_999_999;

export function saleOptionLabel(sale: SaleTestOption): string {
  return `${sale.contactName} · ${sale.productText}`;
}

export function saleOptionDetail(sale: SaleTestOption): string {
  const status = (SALE_STATUS_LABELS as Record<string, string>)[sale.status] ?? sale.status;
  return `${formatUsd(sale.finalCents)} · ${status} · ${shortCivil(sale.saleDate)}`;
}

/** «Cuota · USD 250,00 · cobrado el 10/10 · Whop». */
export function paymentOptionLabel(payment: SalePaymentOption, methods: Readonly<Record<string, string | undefined>> = {}): string {
  const type = (PAYMENT_TYPE_LABELS as Record<string, string>)[payment.type] ?? payment.type;
  const when = payment.paidOn ? `cobrado el ${shortCivil(payment.paidOn)}` : payment.dueDate ? `vence el ${shortCivil(payment.dueDate)}` : ((PAYMENT_STATUS_LABELS as Record<string, string>)[payment.status] ?? payment.status);
  const parts = [type, formatUsd(payment.amountCents), when];
  if (payment.method) parts.push(methods[payment.method] ?? payment.method);
  return parts.join(" · ");
}

export type TestTarget =
  | { kind: "payment"; paymentId: string }
  | { kind: "hypothetical"; amountText: string; method: string };

export type PreviewRequest = { ok: true; input: Record<string, unknown> } | { ok: false; error: string };

/**
 * El pedido para `previewCommissions`. Con una regla sin guardar (`draftRule`) viaja en `draftRules`: reemplaza a la
 * guardada con el mismo id, o se suma si es nueva.
 */
export function buildPreviewRequest(saleId: string | null, target: TestTarget | null, draftRule?: Record<string, unknown> | null): PreviewRequest {
  if (!saleId) return { ok: false, error: "Elegí una venta" };
  if (!target) return { ok: false, error: "Elegí un pago o un cobro hipotético" };
  const draftRules = draftRule ? { draftRules: [draftRule] } : {};
  if (target.kind === "payment") return { ok: true, input: { paymentId: target.paymentId, ...draftRules } };

  const cents = usdTextToCents(target.amountText);
  if (cents === null) return { ok: false, error: "Poné el monto del cobro en dólares (por ejemplo 250 o 99,50)" };
  if (cents <= 0) return { ok: false, error: "El monto tiene que ser mayor que 0" };
  if (cents > MAX_TEST_CENTS) return { ok: false, error: "Ese monto es demasiado grande" };
  return { ok: true, input: { saleId, amountCents: cents, method: target.method || null, ...draftRules } };
}
