/**
 * Que se puede comparar de una venta o un pago en un camino condicional
 * ("Condiciones"). PURO.
 *
 * Solo van las variables que se leen igual que como se guardan: nombres,
 * estados (ya en español: `{{sale.status}}` dice "Pagada", no `paid`), UTM y
 * medio de pago. Los montos y las fechas salen FORMATEADOS para leerse
 * (`$1.297,00`, "12 de octubre"), no se pueden comparar como numero o fecha, y
 * por eso no se ofrecen; para eso estan los campos del contacto (monto total
 * comprado, pagos morosos...). Queda anotado en docs/PENDIENTE.md.
 */
import type { ConditionFieldSpec } from "@/lib/flow-engine/condition-eval";

export const SALES_GROUP = "De la venta";

const TEXT_FIELDS: Array<[string, string]> = [
  ["sale.product_name", "Producto"],
  ["sale.variant_name", "Variante"],
  ["sale.status", "Estado de la venta"],
  ["sale.from_status", "Estado anterior de la venta"],
  ["sale.vendedor_name", "Vendedor"],
  ["sale.setter_name", "Setter"],
  ["sale.utm_source", "UTM source"],
  ["sale.utm_medium", "UTM medium"],
  ["sale.utm_campaign", "UTM campaign"],
  ["sale.attribution_type", "Tipo de atribución"],
  ["payment.method", "Medio de pago"],
  ["payment.from_status", "Estado anterior del pago"],
  ["payment.to_status", "Estado nuevo del pago"],
];

/** Los de pago solo existen cuando el disparador es de un pago. */
export function salesVariableSchema(triggerType: string): ConditionFieldSpec[] {
  const isPayment = triggerType.startsWith("payment_");
  return TEXT_FIELDS.filter(([path]) => isPayment || !path.startsWith("payment.")).map(([path, label]) => ({
    path,
    label,
    type: "text" as const,
    group: SALES_GROUP,
  }));
}
