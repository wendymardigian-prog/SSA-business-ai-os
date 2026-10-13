/**
 * Las variables de una venta y de un pago en el contexto de un flujo (plano F37). PURO.
 *
 *   {{sale.product_name}} {{sale.variant_name}} {{sale.final_amount}} {{sale.balance}}
 *   {{sale.status}} {{sale.from_status}} {{sale.vendedor_name}} {{sale.setter_name}}
 *   {{sale.utm_source}} {{sale.utm_medium}} {{sale.utm_campaign}} {{sale.utm_content}} {{sale.utm_term}}
 *   {{sale.attribution_type}}
 *   {{payment.amount}} {{payment.due_date}} {{payment.days_overdue}} {{payment.delay_days}}
 *   {{payment.method}} {{payment.from_status}} {{payment.to_status}}
 *   {{contact.first_name}} {{contact.display_name}}   (el contacto de la venta)
 *
 * Todo TEXTO: un dato que falta queda vacío, así un mensaje no muestra `{{payment.due_date}}` ni
 * "null". Los montos salen como `$1.297,00`, los estados con su etiqueta en español y las fechas largas.
 * `sale.id` y `payment.id` también están: `{{form_link.*}}` firma el link con la venta del flujo.
 */
import { ATTRIBUTION_TYPE_LABELS, paymentStatusLabel, saleStatusLabel, type AttributionType } from "../labels";
import { formatMoney } from "../format";
import { saleBalance } from "../sale-math";
import { paymentMethodName } from "../payment-methods";
import { snapshotText } from "../sale-text";

export const SALES_VARIABLE_KEYS = [
  "sale.product_name",
  "sale.variant_name",
  "sale.final_amount",
  "sale.balance",
  "sale.status",
  "sale.from_status",
  "sale.utm_source",
  "sale.utm_medium",
  "sale.utm_campaign",
  "sale.utm_content",
  "sale.utm_term",
  "sale.attribution_type",
  "sale.vendedor_name",
  "sale.setter_name",
  "payment.amount",
  "payment.due_date",
  "payment.days_overdue",
  "payment.delay_days",
  "payment.method",
  "payment.from_status",
  "payment.to_status",
  // El contacto de la venta (R3): el primer nombre y el nombre completo. Se suman a las de siempre, sin cambiarlas.
  "contact.first_name",
  "contact.display_name",
] as const;

export interface SalesVariablesInput {
  sale: {
    id: string;
    status: string;
    final_amount: unknown;
    product_snapshot: unknown;
    attribution: unknown;
    attribution_type: string;
    vendedor_id: string | null;
    setter_id: string | null;
  } | null;
  /** Los pagos de la venta (para el saldo). */
  salePayments?: ReadonlyArray<{ amount: unknown; status: string }>;
  payment?: { id: string; amount: unknown; due_date: string | null; payment_method: string | null; status: string; delay_days?: number | null } | null;
  /** El payload del evento (de ahí salen los estados «desde» y «hacia», el atraso y los días de mora). */
  event?: Record<string, unknown>;
  /** Nombres de las personas del equipo, por id. */
  names?: Record<string, string>;
  /** El contacto de la venta (para `{{contact.first_name}}` y `{{contact.display_name}}`). */
  contact?: { display_name?: string | null } | null;
}

export interface SalesVariables {
  sale: Record<string, string>;
  payment: Record<string, string>;
  contact: Record<string, string>;
}

const s = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

function longDate(date: string | null | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function salesVariables(input: SalesVariablesInput): SalesVariables {
  const { sale, payment, event = {}, names = {} } = input;
  const snapshot = (sale?.product_snapshot ?? {}) as { product_name?: unknown; variant_name?: unknown };
  const attribution = (sale?.attribution ?? {}) as Record<string, unknown>;

  const saleVars: Record<string, string> = {
    id: sale?.id ?? "",
    product_name: sale ? s(snapshot.product_name) || snapshotText(sale.product_snapshot) : "",
    variant_name: s(snapshot.variant_name),
    final_amount: sale ? formatMoney(sale.final_amount) : "",
    balance: sale && input.salePayments ? formatMoney(saleBalance(sale.final_amount, input.salePayments)) : "",
    status: sale ? saleStatusLabel(sale.status) : "",
    from_status: s(event.from_status) && typeof event.sale_id === "string" && !event.payment_id ? saleStatusLabel(s(event.from_status)) : "",
    utm_source: s(attribution.source),
    utm_medium: s(attribution.medium),
    utm_campaign: s(attribution.campaign),
    utm_content: s(attribution.content),
    utm_term: s(attribution.term),
    attribution_type: sale ? ATTRIBUTION_TYPE_LABELS[sale.attribution_type as AttributionType] ?? "" : "",
    vendedor_name: sale?.vendedor_id ? names[sale.vendedor_id] ?? "" : "",
    setter_name: sale?.setter_id ? names[sale.setter_id] ?? "" : "",
  };

  const paymentVars: Record<string, string> = {
    id: payment?.id ?? "",
    amount: payment ? formatMoney(payment.amount) : "",
    due_date: longDate(payment?.due_date),
    days_overdue: s(event.days_overdue),
    delay_days: s(event.delay_days ?? payment?.delay_days),
    method: payment?.payment_method ? paymentMethodName(payment.payment_method) : "",
    from_status: s(event.from_status) && event.payment_id ? paymentStatusLabel(s(event.from_status)) : "",
    to_status: s(event.to_status) && event.payment_id ? paymentStatusLabel(s(event.to_status)) : "",
  };

  // `first_name` no es una columna: es la primera palabra del nombre (como en las secuencias).
  const displayName = (input.contact?.display_name ?? "").replace(/\s+/g, " ").trim();
  const contactVars: Record<string, string> = { first_name: displayName.split(" ")[0] ?? "", display_name: displayName };

  return { sale: saleVars, payment: paymentVars, contact: contactVars };
}
