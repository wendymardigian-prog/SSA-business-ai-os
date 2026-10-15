/**
 * «Probar con una venta» (F58). Puro: dado el negocio (roles + reglas) y los hechos de un cobro, dice qué regla
 * gana en cada rol, a quién le tocaría y cuánto, y por qué las reglas de arriba se quedaron afuera. No escribe
 * nada: la Server Action `previewCommissions` solo arma los hechos y llama acá.
 *
 * Usa las mismas funciones que el motor (`pickRule`, `explainRule`, `payeeFor`, `commissionAmount`), así que
 * la respuesta es la que daría el cobro de verdad, con una salvedad: un monto en cero NO genera comisión
 * (la base lo salta), y acá se dice `applies = false` con `reason = "zero_amount"`.
 */
import { z } from "zod";
import { firstPaymentType } from "@/lib/sales/payment-plan";
import { toCents } from "@/lib/sales/money";
import { decodeUtm } from "@/lib/attribution/meta-match";
import { commissionAmount, explainRule, payeeFor, type RuleDimension } from "./rules";
import { ruleConditionsSchema } from "./rule-schema";
import type { CommissionFacts, CommissionRole, CommissionRule, RuleConditions } from "./types";

/** Cómo se llama en palabras la condición que dejó afuera a una regla. */
export const DIMENSION_LABELS: Record<RuleDimension, string> = {
  user_ids: "la persona",
  vendedor_ids: "el vendedor",
  setter_ids: "el setter",
  product_ids: "el producto",
  variant_ids: "la variante",
  financing_types: "el tipo de financiamiento",
  payment_methods: "el método de pago",
  payment_types: "el tipo de pago",
  channels: "el canal",
  platforms: "la red",
  content_post_ids: "la pieza",
  meta_campaign_ids: "la campaña de Meta",
  meta_ad_ids: "el anuncio de Meta",
  "utm.source": "la fuente (UTM)",
  "utm.medium": "el medio (UTM)",
  "utm.campaign": "la campaña (UTM)",
  "utm.content": "el contenido (UTM)",
  "utm.term": "el término (UTM)",
  payment_number: "el número de pago",
  sale_amount: "el monto de la venta",
  validity: "la vigencia",
};

export type PreviewReason = "no_rule" | "not_applicable" | "no_person" | "zero_amount";

export const PREVIEW_REASON_MESSAGES: Record<PreviewReason, string> = {
  no_rule: "Ninguna regla de este rol matchea con este cobro",
  not_applicable: "La regla matchea pero no hay a quién pagarle (la venta o la pieza no tiene esa persona)",
  no_person: "Quedaría «Sin persona»: hay que asignarla a mano",
  zero_amount: "El monto da 0, no se genera",
};

/** Una regla de arriba que no matcheó, y por qué. */
export interface SkippedRule {
  ruleId: string;
  name: string;
  position: number;
  dimension: RuleDimension;
  /** «No matchea por el producto». */
  reason: string;
}

export interface CommissionPreviewRole {
  roleKey: string;
  roleName: string;
  payee: CommissionRole["payee"];
  /** La regla ganadora (o null). */
  rule: { id: string; name: string; position: number; holdDays: number; draft: boolean } | null;
  /** `true` = este cobro generaría una comisión para este rol. */
  applies: boolean;
  reason: PreviewReason | null;
  userId: string | null;
  userName: string | null;
  baseCents: number;
  amountCents: number;
  /** Las reglas de arriba de la ganadora (o todas, si ninguna ganó) que no matchearon. */
  skipped: SkippedRule[];
}

export interface CommissionPreview {
  roles: CommissionPreviewRole[];
  /** Suma de lo que se generaría. */
  totalCents: number;
}

/** Las reglas de la base con las que la pantalla manda sin guardar: reemplazan por `id`, o se suman. */
export function mergeDraftRules(saved: readonly CommissionRule[], drafts: readonly CommissionRule[] | undefined): CommissionRule[] {
  if (!drafts?.length) return [...saved];
  const draftById = new Map(drafts.map((d) => [d.id, d]));
  const merged = saved.map((r) => draftById.get(r.id) ?? r);
  const savedIds = new Set(saved.map((r) => r.id));
  for (const d of drafts) if (!savedIds.has(d.id)) merged.push(d);
  return merged;
}

export function buildCommissionPreview(args: {
  roles: readonly CommissionRole[];
  rules: readonly CommissionRule[];
  facts: CommissionFacts;
  /** Id de persona → nombre. */
  names?: ReadonlyMap<string, string>;
  /** Ids de las reglas que vienen de la pantalla sin guardar (para marcarlas). */
  draftIds?: ReadonlySet<string>;
}): CommissionPreview {
  const { roles, rules, facts, names, draftIds } = args;
  const out: CommissionPreviewRole[] = [];

  for (const role of roles.filter((r) => r.active)) {
    const live = rules
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => rule.role === role.key && rule.is_active && !rule.archived_at)
      .sort((a, b) => a.rule.position - b.rule.position || a.index - b.index)
      .map(({ rule }) => rule);

    const skipped: SkippedRule[] = [];
    let winner: CommissionRule | null = null;
    for (const rule of live) {
      const verdict = explainRule(rule, facts, role);
      if (verdict.matched) {
        winner = rule;
        break;
      }
      const dimension = verdict.failedDimension as RuleDimension;
      skipped.push({ ruleId: rule.id, name: rule.name, position: rule.position, dimension, reason: `No matchea por ${DIMENSION_LABELS[dimension]}` });
    }

    const base: CommissionPreviewRole = {
      roleKey: role.key,
      roleName: role.name,
      payee: role.payee,
      rule: null,
      applies: false,
      reason: "no_rule",
      userId: null,
      userName: null,
      baseCents: 0,
      amountCents: 0,
      skipped,
    };
    if (!winner) {
      out.push(base);
      continue;
    }

    base.rule = { id: winner.id, name: winner.name, position: winner.position, holdDays: winner.hold_days, draft: !!draftIds?.has(winner.id) };
    const payee = payeeFor(role, winner, facts);
    if (!payee.applies) {
      out.push({ ...base, reason: "not_applicable" });
      continue;
    }
    const { baseCents, amountCents } = commissionAmount(winner, facts);
    const userName = payee.userId ? names?.get(payee.userId) ?? null : null;
    if (amountCents <= 0) {
      out.push({ ...base, reason: "zero_amount", userId: payee.userId, userName, baseCents, amountCents });
      continue;
    }
    out.push({ ...base, applies: true, reason: payee.userId ? null : "no_person", userId: payee.userId, userName, baseCents, amountCents });
  }

  return { roles: out, totalCents: out.filter((r) => r.applies).reduce((sum, r) => sum + r.amountCents, 0) };
}

// ── Los hechos de un cobro que todavía no pasó ─────────────────────────────────────────────────────────────

/** Lo que se lee de la venta para armar el cobro hipotético. */
export interface HypotheticalSale {
  id: string;
  status: string;
  financing_type: string;
  final_amount: unknown;
  product_variant_id: string | null;
  /** Producto de la variante, o el del snapshot de la venta. */
  product_id: string | null;
  setter_id: string | null;
  vendedor_id: string | null;
  contact_id: string | null;
}

export interface HypotheticalTouch {
  id: string;
  channel: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content_label: string | null;
  term: string | null;
  content_post_id: string | null;
  social_post_id: string | null;
  meta_ad_id: string | null;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
}

/** Igual que la base: decodificado, sin espacios de más, y vacío = null. */
const cleanUtm = (value: string | null | undefined): string | null => {
  const text = (decodeUtm(value) ?? "").trim();
  return text === "" ? null : text;
};

/**
 * Los hechos de un cobro hipotético de una venta, con la misma forma que `commission_facts(payment_id)`.
 * `livePayments` son los pagos de la venta que no son reembolsos ni están cancelados: el cobro nuevo es el
 * siguiente. El tipo del pago sigue la regla del plan de pagos (el primero según el financiamiento, el resto cuotas).
 */
export function hypotheticalFacts(args: {
  sale: HypotheticalSale;
  touch: HypotheticalTouch | null;
  contentAssigneeId: string | null;
  livePayments: number;
  amountCents: number;
  method: string | null;
  /** Comisión del procesador en dólares; null = el método no tiene. */
  feeAmount: number | null;
  todayLocal: string;
}): CommissionFacts {
  const { sale, touch } = args;
  const number = Math.max(0, Math.floor(args.livePayments)) + 1;
  const financing = sale.financing_type as Parameters<typeof firstPaymentType>[0];
  return {
    payment: {
      id: "hypothetical",
      type: number === 1 ? firstPaymentType(financing) : "installment",
      amount: args.amountCents / 100,
      paid_on: args.todayLocal,
      method: args.method,
      fee_amount: args.feeAmount,
      number,
    },
    sale: {
      id: sale.id,
      status: sale.status,
      financing_type: sale.financing_type,
      final_amount: toCents(sale.final_amount) / 100,
      product_id: sale.product_id,
      variant_id: sale.product_variant_id,
      setter_id: sale.setter_id,
      vendedor_id: sale.vendedor_id,
      contact_id: sale.contact_id,
    },
    touch: touch
      ? {
          id: touch.id,
          channel: touch.channel,
          source: touch.source,
          medium: cleanUtm(touch.medium),
          campaign: cleanUtm(touch.campaign),
          content: cleanUtm(touch.content_label),
          term: cleanUtm(touch.term),
          content_post_id: touch.content_post_id,
          social_post_id: touch.social_post_id,
          meta_ad_id: touch.meta_ad_id,
          meta_adset_id: touch.meta_adset_id,
          meta_campaign_id: touch.meta_campaign_id,
        }
      : null,
    content_assignee_id: touch && (touch.content_post_id || touch.social_post_id) ? args.contentAssigneeId : null,
  };
}

// ── Lo que manda la pantalla ───────────────────────────────────────────────────────────────────────────────

const nullableNumber = z.number().finite().nullish().transform((v) => v ?? null);
const nullableDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v ?? null);

/** Una regla sin guardar, como la arma el editor. Estricto en las condiciones, laxo en lo que el motor no mira. */
export const draftRuleSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(120).default(""),
  role: z.string().regex(/^[a-z0-9_]{2,40}$/),
  position: z.number().int().min(1).max(100_000),
  conditions: ruleConditionsSchema.default({}),
  calc_type: z.enum(["percent", "fixed"]),
  rate: nullableNumber,
  fixed_amount: nullableNumber,
  base: z.enum(["gross", "net_of_fees"]).default("gross"),
  beneficiary_user_id: z.uuid().nullish().transform((v) => v ?? null),
  hold_days: z.number().int().min(0).max(365).default(0),
  valid_from: nullableDate,
  valid_until: nullableDate,
  is_active: z.boolean().default(true),
  archived_at: z.string().nullish().transform((v) => v ?? null),
});

export function parseDraftRules(input: unknown): { ok: true; rules: CommissionRule[] } | { ok: false } {
  const parsed = z.array(draftRuleSchema).max(200).safeParse(input ?? []);
  if (!parsed.success) return { ok: false };
  return { ok: true, rules: parsed.data.map((r) => ({ ...r, conditions: r.conditions as RuleConditions })) };
}

export const previewInputSchema = z.union([
  z.object({ paymentId: z.uuid() }),
  z.object({
    saleId: z.uuid(),
    amountCents: z.number().int().positive().max(99_999_999_999),
    method: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/).nullish().transform((v) => v ?? null),
  }),
]);
