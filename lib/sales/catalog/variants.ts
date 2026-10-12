/** Variantes de un producto (plano F4): duración, garantía y facturación. El precio vive en la variante (00169). */
import { z } from "zod";
import { formatMoney } from "../format";

export const DURATION_TYPES = ["days", "weeks", "months", "lifetime"] as const;
export const GUARANTEE_TYPES = ["days", "weeks", "months"] as const;
export const BILLING_TYPES = ["one_time", "recurring"] as const;
export const BILLING_INTERVALS = ["monthly", "quarterly", "yearly"] as const;

export type DurationType = (typeof DURATION_TYPES)[number];
export type BillingType = (typeof BILLING_TYPES)[number];
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const DURATION_LABELS: Record<DurationType, [string, string]> = {
  days: ["día", "días"],
  weeks: ["semana", "semanas"],
  months: ["mes", "meses"],
  lifetime: ["de por vida", "de por vida"],
};
export const BILLING_INTERVAL_LABELS: Record<BillingInterval, string> = {
  monthly: "todos los meses",
  quarterly: "cada 3 meses",
  yearly: "todos los años",
};

const positiveInt = z.coerce.number().int("Tiene que ser un número entero").positive("Tiene que ser mayor que cero").max(10_000);

/**
 * Lo que llega del formulario de variante, ya normalizado:
 *  - lifetime => duration_value null (y no se pide);
 *  - one_time => billing_interval null; recurring => intervalo obligatorio;
 *  - garantía: las dos o ninguna.
 */
export const variantInputSchema = z
  .object({
    name: z.string().trim().min(1, "Poné un nombre").max(120, "Máximo 120 caracteres"),
    durationType: z.enum(DURATION_TYPES),
    durationValue: z.union([positiveInt, z.literal(""), z.null(), z.undefined()]).optional(),
    guaranteeType: z.union([z.enum(GUARANTEE_TYPES), z.literal(""), z.null(), z.undefined()]).optional(),
    guaranteeValue: z.union([positiveInt, z.literal(""), z.null(), z.undefined()]).optional(),
    billingType: z.enum(BILLING_TYPES),
    billingInterval: z.union([z.enum(BILLING_INTERVALS), z.literal(""), z.null(), z.undefined()]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.durationType !== "lifetime" && (v.durationValue === "" || v.durationValue == null)) {
      ctx.addIssue({ code: "custom", path: ["durationValue"], message: "Poné cuánto dura" });
    }
    if (v.billingType === "recurring" && !v.billingInterval) {
      ctx.addIssue({ code: "custom", path: ["billingInterval"], message: "Elegí cada cuánto se cobra" });
    }
    const hasGType = !!v.guaranteeType;
    const hasGValue = v.guaranteeValue !== "" && v.guaranteeValue != null;
    if (hasGType !== hasGValue) {
      ctx.addIssue({ code: "custom", path: ["guaranteeValue"], message: "La garantía necesita el tipo y el valor, o ninguno" });
    }
  });

export type VariantInput = z.input<typeof variantInputSchema>;

export interface VariantFields {
  name: string;
  duration_type: DurationType;
  duration_value: number | null;
  guarantee_duration_type: (typeof GUARANTEE_TYPES)[number] | null;
  guarantee_duration_value: number | null;
  billing_type: BillingType;
  billing_interval: BillingInterval | null;
}

export type VariantParse = { ok: true; fields: VariantFields } | { ok: false; error: string };

/** Valida y deja las columnas listas para escribir (lo que no corresponde queda null). */
export function parseVariantInput(input: unknown): VariantParse {
  const result = variantInputSchema.safeParse(input);
  if (!result.success) return { ok: false, error: result.error.issues[0]?.message ?? "Datos de variante inválidos" };
  const v = result.data;
  const lifetime = v.durationType === "lifetime";
  const durationValue = lifetime || v.durationValue === "" || v.durationValue == null ? null : Number(v.durationValue);
  const hasGuarantee = !!v.guaranteeType && v.guaranteeValue !== "" && v.guaranteeValue != null;
  return {
    ok: true,
    fields: {
      name: v.name,
      duration_type: v.durationType,
      duration_value: durationValue,
      guarantee_duration_type: hasGuarantee ? (v.guaranteeType as (typeof GUARANTEE_TYPES)[number]) : null,
      guarantee_duration_value: hasGuarantee ? Number(v.guaranteeValue) : null,
      billing_type: v.billingType,
      billing_interval: v.billingType === "recurring" ? ((v.billingInterval || null) as BillingInterval | null) : null,
    },
  };
}

export function describeDuration(type: string, value: number | null | undefined): string {
  if (type === "lifetime") return "De por vida";
  const labels = DURATION_LABELS[type as DurationType];
  if (!labels || !value) return "—";
  return `${value} ${value === 1 ? labels[0] : labels[1]}`;
}

export function describeGuarantee(type: string | null | undefined, value: number | null | undefined): string {
  if (!type || !value) return "Sin garantía";
  return `${describeDuration(type, value)} de garantía`;
}

export function describeBilling(type: string, interval: string | null | undefined): string {
  if (type === "one_time") return "Pago único";
  return `Recurrente, ${BILLING_INTERVAL_LABELS[interval as BillingInterval] ?? "—"}`;
}

export interface VariantRowInput {
  id: string;
  name: string;
  duration_type: string;
  duration_value: number | null;
  guarantee_duration_type: string | null;
  guarantee_duration_value: number | null;
  billing_type: string;
  billing_interval: string | null;
  archived_at: string | null;
  display_order?: number;
}

export interface VariantRow {
  id: string;
  name: string;
  /** Precio de la versión activa; null si no tiene (no se puede vender). */
  activePrice: number | null;
  priceLabel: string;
  duration: string;
  guarantee: string;
  billing: string;
  archived: boolean;
  sellable: boolean;
}

/** La fila que muestra la lista de variantes. Sin versión activa no se vende y se dice por qué. */
export function variantRow(variant: VariantRowInput, activePrice: number | null): VariantRow {
  const archived = !!variant.archived_at;
  return {
    id: variant.id,
    name: variant.name,
    activePrice,
    priceLabel: activePrice === null ? "Sin precio" : formatMoney(activePrice),
    duration: describeDuration(variant.duration_type, variant.duration_value),
    guarantee: describeGuarantee(variant.guarantee_duration_type, variant.guarantee_duration_value),
    billing: describeBilling(variant.billing_type, variant.billing_interval),
    archived,
    sellable: !archived && activePrice !== null,
  };
}

/** Si archivar esta variante deja al producto sin ninguna activa (hay que advertirlo). */
export function archiveLeavesProductUnsellable(
  variants: ReadonlyArray<{ id: string; archived_at: string | null }>,
  variantId: string,
): boolean {
  const others = variants.filter((v) => v.id !== variantId && !v.archived_at);
  return others.length === 0;
}
