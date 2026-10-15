/**
 * Crear una venta (plano F22): la parte PURA. Valida con Zod, aplica las reglas
 * que decide el servidor (cuadre, descuento, métodos, fechas, alcance) y arma el
 * payload que recibe `create_sale` (00162). La Server Action solo orquesta.
 */
import { z } from "zod";
import { wallClockToUtc } from "@/lib/scheduling/time/tz";
import { computeProviderFee, buildPaymentOptionSnapshot } from "./fees";
import { FINANCING_TYPES, PAYMENT_TYPES } from "./labels";
import { toCents, fromCents } from "./money";
import { isKnownMethod, type PaymentMethodDef } from "./payment-methods";
import { validatePlanBalances } from "./payment-plan";
import { checkDiscount, type ProductSnapshot } from "./sale-math";
import { isDateOnly, localToday } from "./dates";
import { manualAttributionSchema, type AttributionRequest } from "./attribution";

const dateOnly = z.string().refine(isDateOnly, "La fecha no es válida");
const uuid = z.string().uuid();

export const paymentInputSchema = z.object({
  type: z.enum(PAYMENT_TYPES).refine((t) => t !== "refund", "Un reembolso no se carga al crear la venta"),
  amount: z.coerce.number().positive("El monto tiene que ser mayor que cero").max(10_000_000),
  status: z.enum(["paid", "scheduled"]),
  /** Fecha efectiva (si ya está cobrado) o vencimiento (si está programado). */
  date: dateOnly,
  method: z.string().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

/** La atribución que viaja del navegador: último toque, otro toque del historial o cargada a mano. */
export const attributionRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("last_touch") }),
  z.object({ mode: z.literal("touch"), touchId: uuid }),
  z.object({ mode: z.literal("manual"), manual: manualAttributionSchema }),
]);

export const createSaleInputSchema = z.object({
  contactId: uuid,
  /** La variante que se vende y el precio que el asistente MOSTRÓ: si el precio ya cambió, se rechaza con el nuevo. */
  variantId: uuid,
  shownPrice: z.coerce.number().min(0),
  discount: z
    .union([
      z.object({ type: z.literal("amount"), value: z.coerce.number().min(0) }),
      z.object({ type: z.literal("percent"), value: z.coerce.number().min(0).max(100) }),
      z.null(),
    ])
    .optional()
    .default(null),
  discountReason: z.string().trim().max(500).nullable().optional(),
  financing: z.enum(FINANCING_TYPES),
  subscriptionInterval: z.enum(["monthly", "quarterly", "yearly"]).nullable().optional(),
  saleDate: dateOnly,
  setterId: uuid.nullable().optional(),
  vendedorId: uuid.nullable().optional(),
  attribution: attributionRequestSchema.default({ mode: "last_touch" }),
  bookingId: uuid.nullable().optional(),
  serviceStartsAt: dateOnly.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  payments: z.array(paymentInputSchema).min(1, "La venta necesita al menos un pago").max(60),
});

export type CreateSaleInput = z.input<typeof createSaleInputSchema>;
export type CreateSaleParsed = z.output<typeof createSaleInputSchema>;

export type SaleCode =
  | "invalid"
  | "price_changed"
  | "plan_unbalanced"
  | "discount"
  | "method"
  | "date"
  | "scope"
  | "invalid_touch"
  | "invalid_manual"
  | "invalid_booking"
  | "invalid_contact"
  | "server";

export interface SaleRuleContext {
  timeZone: string;
  now: Date;
  enabledMethods: readonly string[];
  /** Los métodos del negocio con su comisión (`workspaces.payment_methods`). Sin esto, el catálogo de arranque. */
  methods?: readonly PaymentMethodDef[];
  maxDiscountPercent: number | null;
  /** Alcance de ventas de quien carga: con `own` tiene que quedar como setter o vendedor. */
  hasAllScope: boolean;
  userId: string;
  /** El catálogo releído en el servidor. */
  variant: { id: string; price: number };
  snapshot: ProductSnapshot;
}

export type SaleRulesResult =
  | { ok: true; payload: Record<string, unknown>; finalAmount: number }
  | { ok: false; code: SaleCode; error: string; diffCents?: number; newPrice?: number };

/** Las filas de `payments` que recibe `create_sale`: lo cobrado lleva fecha local, instante, método y comisión congelada. */
export function buildPaymentRows(
  payments: ReadonlyArray<z.output<typeof paymentInputSchema>>,
  ctx: Pick<SaleRuleContext, "timeZone" | "now"> & { methods?: readonly PaymentMethodDef[] },
): Array<Record<string, unknown>> {
  const today = localToday(ctx.now, ctx.timeZone);
  return payments.map((p) => {
    if (p.status === "scheduled") {
      return { type: p.type, amount: fromCents(toCents(p.amount)), status: "scheduled", due_date: p.date, payment_method: p.method ?? null, notes: p.notes ?? null };
    }
    const method = p.method as string;
    const paidAt = p.date === today ? ctx.now : wallClockToUtc(p.date, "12:00", ctx.timeZone);
    return {
      type: p.type,
      amount: fromCents(toCents(p.amount)),
      status: "paid",
      // Lo cobrado vence el día que se cobró: nace puntual (desfase 0).
      due_date: p.date,
      paid_on: p.date,
      paid_at: paidAt.toISOString(),
      payment_method: method,
      payment_option_snapshot: buildPaymentOptionSnapshot(method, ctx.methods),
      provider_fee_amount: computeProviderFee(p.amount, method, ctx.methods),
      notes: p.notes ?? null,
    };
  });
}

/**
 * Las reglas del servidor sobre una venta ya parseada. El orden importa para que el
 * error sea el más útil: descuento → fechas → métodos → alcance → cuadre.
 */
export function applySaleRules(input: CreateSaleParsed, ctx: SaleRuleContext): SaleRulesResult {
  const today = localToday(ctx.now, ctx.timeZone);

  // Descuento: no negativo, y sobre el tope pide motivo + alcance `all`.
  const discount = checkDiscount(ctx.snapshot.price, input.discount, {
    maxPercent: ctx.maxDiscountPercent,
    reason: input.discountReason,
    hasAllScope: ctx.hasAllScope,
  });
  if (!discount.ok) return { ok: false, code: "discount", error: discount.error };

  if (input.saleDate > today) return { ok: false, code: "date", error: "La fecha de la venta no puede ser futura" };
  for (const p of input.payments) {
    if (p.status === "paid") {
      if (p.date < input.saleDate) return { ok: false, code: "date", error: "Un pago no puede estar cobrado antes de la fecha de la venta" };
      if (p.date > today) return { ok: false, code: "date", error: "Un pago cobrado no puede tener fecha futura" };
      if (!p.method || !isKnownMethod(p.method, ctx.methods)) return { ok: false, code: "method", error: "Elegí el método de pago de lo que ya se cobró" };
      if (!ctx.enabledMethods.includes(p.method)) return { ok: false, code: "method", error: "Ese método de pago no está habilitado" };
    } else if (p.method && !isKnownMethod(p.method, ctx.methods)) {
      return { ok: false, code: "method", error: "Ese método de pago no existe" };
    }
  }

  // Un Member con alcance `own` tiene que quedar como setter o vendedor: si no, no podría ver lo que crea.
  if (!ctx.hasAllScope && input.setterId !== ctx.userId && input.vendedorId !== ctx.userId) {
    return { ok: false, code: "scope", error: "Tenés que quedar como setter o como vendedor de la venta para poder verla" };
  }

  if (input.financing === "subscription") {
    if (!input.subscriptionInterval) return { ok: false, code: "invalid", error: "Elegí cada cuánto se cobra la suscripción" };
  } else {
    const check = validatePlanBalances(discount.finalAmount, input.payments);
    if (!check.ok) {
      return { ok: false, code: "plan_unbalanced", diffCents: check.diffCents, error: check.diffCents > 0 ? `Falta asignar ${fromCents(check.diffCents).toFixed(2)}` : `Te pasaste por ${fromCents(-check.diffCents).toFixed(2)}` };
    }
  }

  const attribution: Record<string, unknown> =
    input.attribution.mode === "touch"
      ? { mode: "touch", touch_id: input.attribution.touchId }
      : input.attribution.mode === "manual"
        ? { mode: "manual", manual: parseManual(input.attribution.manual) }
        : { mode: "last_touch" };

  return {
    ok: true,
    finalAmount: discount.finalAmount,
    payload: {
      contact_id: input.contactId,
      product_variant_id: ctx.variant.id,
      product_snapshot: ctx.snapshot,
      base_amount: ctx.snapshot.price,
      discount_amount: discount.discountAmount,
      discount_reason: input.discountReason?.trim() || null,
      financing_type: input.financing,
      subscription_interval: input.financing === "subscription" ? input.subscriptionInterval : null,
      sale_date: input.saleDate,
      setter_id: input.setterId ?? null,
      vendedor_id: input.vendedorId ?? null,
      attribution,
      booking_id: input.bookingId ?? null,
      service_starts_at: input.serviceStartsAt ?? null,
      notes: input.notes?.trim() || null,
      payments: buildPaymentRows(input.payments, ctx),
    },
  };
}

function parseManual(manual: z.output<typeof manualAttributionSchema>): Record<string, unknown> {
  const out: Record<string, unknown> = { source: manual.source };
  for (const key of ["medium", "campaign", "content", "term", "touch_id"] as const) {
    const v = manual[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}

/** Los códigos que devuelve `create_sale` (RAISE EXCEPTION '<codigo>[:detalle]') → un resultado entendible. */
export function mapCreateSaleError(message: string): { code: SaleCode; error: string; diffCents?: number; newPrice?: number } {
  const m = message.match(/(price_changed|plan_unbalanced|invalid_[a-z_]+)(?::(-?\d+(?:\.\d+)?))?/);
  switch (m?.[1]) {
    case "price_changed":
      return { code: "price_changed", error: "El precio del producto cambió mientras cargabas la venta", newPrice: Number(m[2]) || 0 };
    case "invalid_variant":
      return { code: "invalid", error: "Ese producto ya no se ofrece" };
    case "plan_unbalanced":
      return { code: "plan_unbalanced", error: "El plan de pagos no cuadra con el total", diffCents: Number(m[2]) || 0 };
    case "invalid_touch":
      return { code: "invalid_touch", error: "Ese toque no es de este contacto" };
    case "invalid_manual":
      return { code: "invalid_manual", error: "La atribución cargada a mano no es válida" };
    case "invalid_booking":
      return { code: "invalid_booking", error: "Esa agenda no es de este contacto o todavía no ocurrió" };
    case "invalid_contact":
      return { code: "invalid_contact", error: "No encontré ese contacto" };
    case "invalid_sale_date":
      return { code: "date", error: "La fecha de la venta no puede ser futura" };
    default:
      return { code: "server", error: "No pude crear la venta" };
  }
}

export type { AttributionRequest, ProductSnapshot };
