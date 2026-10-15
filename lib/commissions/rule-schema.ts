/**
 * Validación del alta y la edición de una regla de comisión (F57). Puro: lo usan el formulario y la Server
 * Action `lib/actions/commission-rules.ts`, así que dicen lo mismo. La base lo vuelve a exigir con sus CHECK.
 *
 * `commissionRuleInputSchema(role)` es una fábrica porque una regla depende de su rol: con `payee = fixed`, la
 * persona es obligatoria. Que los ids de productos, variantes, personas y métodos existan en el workspace lo
 * valida quien guarda (acá solo la forma).
 */
import { z } from "zod";
import type { CommissionRole, RuleConditions } from "./types";

export const RULE_NAME_MAX = 120;
export const MAX_LIST_ITEMS = 100;
export const MAX_UTM_VALUES = 20;
export const HOLD_DAYS_MAX = 365;

const FINANCING_TYPE = /^[a-z][a-z_]{0,39}$/;
const METHOD_KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const META_ID = /^[A-Za-z0-9_-]{1,40}$/;

const list = <T extends z.ZodTypeAny>(item: T) => z.array(item).max(MAX_LIST_ITEMS, `Hasta ${MAX_LIST_ITEMS} valores por condición`);
const uuidList = list(z.uuid("Un id no es válido"));

const utmCondition = z.strictObject({
  op: z.enum(["equals", "contains"], "Elegí «es igual a» o «contiene»"),
  values: z.array(z.string().trim().min(1).max(200, "Un valor puede tener hasta 200 caracteres")).max(MAX_UTM_VALUES, `Hasta ${MAX_UTM_VALUES} valores`),
});

const decimals = (value: number, places: number): boolean => Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) < 1e-6;

/** Las condiciones de una regla. Estricto: una dimensión que no existe es un error, no se guarda en silencio. */
export const ruleConditionsSchema = z
  .strictObject({
    user_ids: uuidList,
    vendedor_ids: uuidList,
    setter_ids: uuidList,
    product_ids: uuidList,
    variant_ids: uuidList,
    financing_types: list(z.string().regex(FINANCING_TYPE, "Un tipo de financiamiento no es válido")),
    payment_methods: list(z.string().regex(METHOD_KEY, "Un método de pago no es válido")),
    payment_types: list(z.enum(["full", "reservation", "installment"])),
    channels: list(z.enum(["organic", "paid", "referral", "direct"])),
    platforms: list(z.string().trim().toLowerCase().min(1).max(40)),
    content_post_ids: uuidList,
    meta_campaign_ids: list(z.string().regex(META_ID, "Un id de campaña de Meta no es válido")),
    meta_ad_ids: list(z.string().regex(META_ID, "Un id de anuncio de Meta no es válido")),
    utm: z.strictObject({
      source: utmCondition,
      medium: utmCondition,
      campaign: utmCondition,
      content: utmCondition,
      term: utmCondition,
    }).partial(),
    payment_number: z
      .strictObject({ from: z.number().int().min(1).nullish(), to: z.number().int().min(1).nullish() })
      .refine((r) => r.from == null || r.to == null || r.from <= r.to, "El número de pago «desde» no puede ser mayor que «hasta»"),
    sale_amount: z
      .strictObject({ min: z.number().min(0).max(9_999_999_999.99).nullish(), max: z.number().min(0).max(9_999_999_999.99).nullish() })
      .refine((r) => r.min == null || r.max == null || r.min <= r.max, "El monto mínimo no puede ser mayor que el máximo"),
  })
  .partial();

/** Saca de las condiciones lo que no limita nada (listas vacías, rangos sin extremos, UTM sin valores). */
export function cleanConditions(conditions: RuleConditions | null | undefined): RuleConditions {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(conditions ?? {})) {
    if (Array.isArray(value)) {
      if (value.length) out[key] = value;
    } else if (key === "utm" && value && typeof value === "object") {
      const utm: Record<string, unknown> = {};
      for (const [dim, cond] of Object.entries(value as Record<string, { values?: unknown[] } | undefined>)) {
        if (cond && Array.isArray(cond.values) && cond.values.length) utm[dim] = cond;
      }
      if (Object.keys(utm).length) out.utm = utm;
    } else if (value && typeof value === "object") {
      const range = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined));
      if (Object.keys(range).length) out[key] = range;
    }
  }
  return out as RuleConditions;
}

function civilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const optionalDate = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().refine(civilDate, "La fecha no es válida (AAAA-MM-DD)").nullish());

/** El alta o la edición de una regla (los campos del formulario, en camelCase). */
export function commissionRuleInputSchema(role: Pick<CommissionRole, "payee">) {
  return z
    .strictObject({
      name: z.string().trim().min(1, "Poné un nombre").max(RULE_NAME_MAX, `El nombre puede tener hasta ${RULE_NAME_MAX} caracteres`),
      /** La clave del rol (la pestaña en la que se crea). */
      role: z.string().regex(/^[a-z0-9_]{2,40}$/, "El rol no es válido"),
      conditions: ruleConditionsSchema.default({}),
      calcType: z.enum(["percent", "fixed"], "Elegí porcentaje o monto fijo"),
      rate: z.number("Poné el porcentaje").gt(0, "El porcentaje tiene que ser mayor que 0").max(100, "El porcentaje no puede pasar de 100").nullish(),
      fixedAmount: z.number("Poné el monto").gt(0, "El monto tiene que ser mayor que 0").max(9_999_999_999.99).nullish(),
      base: z.enum(["gross", "net_of_fees"], "Elegí la base del cálculo").default("gross"),
      beneficiaryUserId: z.uuid("La persona no es válida").nullish(),
      holdDays: z.number().int("Los días de retención son un número entero").min(0).max(HOLD_DAYS_MAX, `Hasta ${HOLD_DAYS_MAX} días`).default(0),
      validFrom: optionalDate,
      validUntil: optionalDate,
      isActive: z.boolean().default(true),
    })
    .superRefine((v, ctx) => {
      if (v.calcType === "percent") {
        if (v.rate == null) ctx.addIssue({ code: "custom", path: ["rate"], message: "Poné el porcentaje" });
        else if (!decimals(v.rate, 3)) ctx.addIssue({ code: "custom", path: ["rate"], message: "El porcentaje admite hasta 3 decimales" });
      } else {
        if (v.fixedAmount == null) ctx.addIssue({ code: "custom", path: ["fixedAmount"], message: "Poné el monto" });
        else if (!decimals(v.fixedAmount, 2)) ctx.addIssue({ code: "custom", path: ["fixedAmount"], message: "El monto admite hasta 2 decimales" });
      }
      if (role.payee === "fixed" && !v.beneficiaryUserId) {
        ctx.addIssue({ code: "custom", path: ["beneficiaryUserId"], message: "Elegí a quién se le paga: este rol es de una persona fija" });
      }
      if (v.validFrom && v.validUntil && v.validUntil < v.validFrom) {
        ctx.addIssue({ code: "custom", path: ["validUntil"], message: "La vigencia termina antes de empezar" });
      }
    })
    .transform((v) => ({
      ...v,
      conditions: cleanConditions(v.conditions as RuleConditions),
      // Solo se guarda lo que corresponde al tipo de cálculo.
      rate: v.calcType === "percent" ? (v.rate ?? null) : null,
      fixedAmount: v.calcType === "fixed" ? (v.fixedAmount ?? null) : null,
      beneficiaryUserId: v.beneficiaryUserId ?? null,
      validFrom: v.validFrom ?? null,
      validUntil: v.validUntil ?? null,
    }));
}

export type CommissionRuleInput = z.output<ReturnType<typeof commissionRuleInputSchema>>;

/** La regla validada, con los nombres de columna de `commission_rules` (sin id, posición ni auditoría). */
export function commissionRuleRow(input: CommissionRuleInput) {
  return {
    name: input.name,
    role: input.role,
    conditions: input.conditions,
    calc_type: input.calcType,
    rate: input.rate,
    fixed_amount: input.fixedAmount,
    base: input.base,
    beneficiary_user_id: input.beneficiaryUserId,
    hold_days: input.holdDays,
    valid_from: input.validFrom,
    valid_until: input.validUntil,
    is_active: input.isActive,
  };
}
