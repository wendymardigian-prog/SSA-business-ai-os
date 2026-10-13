/**
 * Las condiciones de Ventas (plano F37) para el nodo Condition. Nueve campos; las cuentas viven en
 * `lib/sales/automation/conditions.ts` (puras). Acá solo se leen las filas.
 *
 *   has_active_sale:        ¿tiene una venta activa? (arg opcional: producto o variante)
 *   last_sale_status        el estado de su última venta
 *   has_overdue_payments    ¿tiene pagos morosos?
 *   late_payments_count:    cuántos pagos cobrados con atraso mayor a N días (arg = N)
 *   total_purchased         el monto total comprado (cobrado neto)
 *   sale_utm:               UTM de LA VENTA del flujo (arg = source | medium | campaign)
 *   sale_attribution_type   último toque / manual / sin atribución
 *   sale_from_booking       ¿la venta vino de una agenda?
 *   sale_booking_event_type el tipo de evento de la agenda de la venta (id)
 *
 * «La venta del flujo» es la que lo disparó (`event_sale_id`); sin ella, la última del contacto.
 */
import { registerConditionField } from "./registry";
import type { ConditionFieldArgs } from "./types";
import {
  hasActiveSale, hasOverduePayments, lastSaleStatus, latePaymentsCount, newestFirst, saleAttributionType, saleFromBooking, saleUtm, totalPurchased,
  type ConditionPayment, type ConditionSale,
} from "@/lib/sales/automation/conditions";
import { requireContactId } from "../types";

const SALE_COLUMNS = "id, status, sale_date, created_at, product_snapshot, attribution, attribution_type, booking_id";

async function salesOf(args: ConditionFieldArgs): Promise<ConditionSale[]> {
  const { data } = await args.supabase
    .from("sales")
    .select(SALE_COLUMNS)
    .eq("workspace_id", args.context.workspaceId)
    .eq("contact_id", requireContactId(args.context))
    .limit(200);
  return (data ?? []) as unknown as ConditionSale[];
}

async function paymentsOf(args: ConditionFieldArgs, sales: readonly ConditionSale[]): Promise<ConditionPayment[]> {
  if (sales.length === 0) return [];
  const { data } = await args.supabase.from("payments").select("type, status, amount, delay_days, sale_id").in("sale_id", sales.map((s) => s.id)).limit(2000);
  return (data ?? []) as unknown as ConditionPayment[];
}

/** La venta del flujo: la que lo disparó, o la última del contacto. */
async function flowSale(args: ConditionFieldArgs): Promise<ConditionSale | null> {
  const eventSaleId = args.context.variables?.event_sale_id;
  const sales = await salesOf(args);
  if (typeof eventSaleId === "string" && eventSaleId) return sales.find((s) => s.id === eventSaleId) ?? null;
  return newestFirst(sales)[0] ?? null;
}

registerConditionField({
  prefix: "has_active_sale:",
  label: "Tiene una venta activa",
  resolve: async (args) => hasActiveSale(await salesOf(args), args.argument),
});

registerConditionField({
  prefix: "last_sale_status",
  label: "Estado de su última venta",
  resolve: async (args) => lastSaleStatus(await salesOf(args)),
});

registerConditionField({
  prefix: "has_overdue_payments",
  label: "Tiene pagos morosos",
  resolve: async (args) => hasOverduePayments(await paymentsOf(args, await salesOf(args))),
});

registerConditionField({
  prefix: "late_payments_count:",
  label: "Pagos con atraso mayor a N días",
  resolve: async (args) => latePaymentsCount(await paymentsOf(args, await salesOf(args)), args.argument),
});

registerConditionField({
  prefix: "total_purchased",
  label: "Monto total comprado",
  resolve: async (args) => totalPurchased(await paymentsOf(args, await salesOf(args))),
});

registerConditionField({
  prefix: "sale_utm:",
  label: "UTM de la venta",
  resolve: async (args) => saleUtm(await flowSale(args), args.argument),
});

registerConditionField({
  prefix: "sale_attribution_type",
  label: "Tipo de atribución de la venta",
  resolve: async (args) => saleAttributionType(await flowSale(args)),
});

registerConditionField({
  prefix: "sale_from_booking",
  label: "La venta vino de una agenda",
  resolve: async (args) => saleFromBooking(await flowSale(args)),
});

registerConditionField({
  prefix: "sale_booking_event_type",
  label: "Tipo de evento de la agenda de la venta",
  resolve: async (args) => {
    const sale = await flowSale(args);
    if (!sale?.booking_id) return "";
    const { data } = await args.supabase.from("bookings").select("event_type_id").eq("id", sale.booking_id).maybeSingle();
    return data?.event_type_id ?? "";
  },
});

/**
 * «Está marcado como no contactar». Los flujos de cobranza lo usan como puerta: es cobranza, no una
 * reunión que el contacto pidió, así que respetan la marca (el nodo de WhatsApp, a diferencia del email,
 * no la mira por sí mismo).
 */
registerConditionField({
  prefix: "do_not_contact",
  label: "Está marcado como no contactar",
  resolve: ({ contact }) => String(contact.do_not_contact === true),
});
