/**
 * Variantes de un producto (plano F4): duración, fecha del evento y facturación. El precio vive en la
 * variante (00169). Qué se pide depende del tipo del producto (`variantTiming`): la duración empieza el
 * día que compra cada cliente; un evento tiene además su fecha fija; un producto no tiene duración.
 * La garantía se sacó (00264).
 */
import { z } from "zod";
import { formatMoney } from "../sales/format";
import { variantTiming, type VariantTiming } from "./products";

export const DURATION_TYPES = ["days", "weeks", "months", "lifetime"] as const;
/** Un evento dura días, semanas o meses: nunca «de por vida». */
export const EVENT_DURATION_TYPES = ["days", "weeks", "months"] as const;
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
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Una fecha civil «AAAA-MM-DD» que existe (no 2026-02-30). */
export function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Lo que llega del formulario de variante, ya normalizado:
 *  - lifetime => duration_value null (y no se pide);
 *  - one_time => billing_interval null; recurring => intervalo obligatorio.
 * Las reglas que dependen del tipo del producto las aplica `parseVariantInput`.
 */
export const variantInputSchema = z
  .object({
    name: z.string().trim().min(1, "Poné un nombre").max(120, "Máximo 120 caracteres"),
    durationType: z.enum(DURATION_TYPES).optional(),
    durationValue: z.union([positiveInt, z.literal(""), z.null(), z.undefined()]).optional(),
    eventDate: z.union([z.string().trim(), z.null(), z.undefined()]).optional(),
    billingType: z.enum(BILLING_TYPES),
    billingInterval: z.union([z.enum(BILLING_INTERVALS), z.literal(""), z.null(), z.undefined()]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.billingType === "recurring" && !v.billingInterval) {
      ctx.addIssue({ code: "custom", path: ["billingInterval"], message: "Elegí cada cuánto se cobra" });
    }
  });

export type VariantInput = z.input<typeof variantInputSchema>;

export interface VariantFields {
  name: string;
  duration_type: DurationType;
  duration_value: number | null;
  event_date: string | null;
  billing_type: BillingType;
  billing_interval: BillingInterval | null;
}

export type VariantParse = { ok: true; fields: VariantFields } | { ok: false; error: string };

/**
 * Valida y deja las columnas listas para escribir (lo que no corresponde queda null), según el tipo
 * del producto:
 *  - duración (programa, mentoría, curso, servicio): la duración es obligatoria y no hay fecha;
 *  - evento: fecha obligatoria y una duración en días, semanas o meses;
 *  - producto: sin duración ni fecha (se guarda como «de por vida», que la base exige).
 */
export function parseVariantInput(input: unknown, productType: string): VariantParse {
  const result = variantInputSchema.safeParse(input);
  if (!result.success) return { ok: false, error: result.error.issues[0]?.message ?? "Datos de variante inválidos" };
  const v = result.data;
  const timing = variantTiming(productType);
  const billing = {
    billing_type: v.billingType,
    billing_interval: v.billingType === "recurring" ? ((v.billingInterval || null) as BillingInterval | null) : null,
  };

  if (timing === "none") {
    return { ok: true, fields: { name: v.name, duration_type: "lifetime", duration_value: null, event_date: null, ...billing } };
  }

  const durationType = v.durationType ?? (timing === "event" ? "days" : "lifetime");
  const hasValue = v.durationValue !== "" && v.durationValue != null;
  if (timing === "event" && durationType === "lifetime") return { ok: false, error: "Un evento dura días, semanas o meses" };
  if (durationType !== "lifetime" && !hasValue) return { ok: false, error: "Poné cuánto dura" };

  let eventDate: string | null = null;
  if (timing === "event") {
    const raw = v.eventDate ?? "";
    if (!raw) return { ok: false, error: "Poné la fecha del evento" };
    if (!isValidDate(raw)) return { ok: false, error: "La fecha del evento no es válida" };
    eventDate = raw;
  }

  return {
    ok: true,
    fields: {
      name: v.name,
      duration_type: durationType,
      duration_value: durationType === "lifetime" ? null : Number(v.durationValue),
      event_date: eventDate,
      ...billing,
    },
  };
}

export function describeDuration(type: string, value: number | null | undefined): string {
  if (type === "lifetime") return "De por vida";
  const labels = DURATION_LABELS[type as DurationType];
  if (!labels || !value) return "—";
  return `${value} ${value === 1 ? labels[0] : labels[1]}`;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/** «15 nov 2026». Una fecha civil: no pasa por zonas horarias. */
export function formatEventDate(value: string | null | undefined): string {
  if (!value || !isValidDate(value)) return "Sin fecha";
  const [y, m, d] = value.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Cuándo y cuánto, según el tipo: «6 meses», «15 nov 2026 · 3 días», o null para un producto. */
export function describeTiming(
  timing: VariantTiming,
  variant: { duration_type: string; duration_value: number | null; event_date?: string | null },
): string | null {
  if (timing === "none") return null;
  const duration = describeDuration(variant.duration_type, variant.duration_value);
  if (timing === "event") return `${formatEventDate(variant.event_date)} · ${duration}`;
  return duration;
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
  event_date?: string | null;
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
  /** Duración (y fecha, si es un evento); null para un producto, que no tiene. */
  timing: string | null;
  /** Un evento sin fecha: pasa cuando el producto cambió de tipo después de crear la variante. */
  missingEventDate: boolean;
  billing: string;
  archived: boolean;
  sellable: boolean;
}

/** La fila que muestra la lista de variantes. Sin versión activa no se vende y se dice por qué. */
export function variantRow(variant: VariantRowInput, activePrice: number | null, productType: string): VariantRow {
  const archived = !!variant.archived_at;
  const timing = variantTiming(productType);
  return {
    id: variant.id,
    name: variant.name,
    activePrice,
    priceLabel: activePrice === null ? "Sin precio" : formatMoney(activePrice),
    timing: describeTiming(timing, variant),
    missingEventDate: timing === "event" && !variant.event_date,
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
