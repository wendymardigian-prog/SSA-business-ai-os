/**
 * Elegir la regla y calcular la comisión de un pago (F52). Puro.
 *
 * Es la GEMELA en TypeScript de las funciones SQL `commission_rule_matches`, `commission_pick_rule`,
 * `commission_payee` y `commission_amount_cents`: los casos de `rules.cases.json` corren contra las dos
 * (Vitest acá, `verify-commissions.mjs` contra la base). Si se cambia una regla, se cambia en las dos y se
 * suma el caso.
 *
 *   - Y entre dimensiones, O dentro de cada lista. Una dimensión vacía = «cualquiera».
 *   - La plata se decide en céntimos enteros; el porcentaje (hasta 3 decimales) se pasa a milésimas
 *     enteras y se redondea sin flotantes (medio céntimo sube).
 *   - Sin condiciones implícitas de canal: si «Contenido» tiene que pagar solo lo orgánico, la regla lo dice.
 */
import { decodeUtm } from "@/lib/attribution/meta-match";
import { toCents } from "@/lib/sales/money";
import {
  UTM_DIMENSIONS,
  type CommissionFacts,
  type CommissionRole,
  type CommissionRule,
  type RuleConditions,
  type UtmDimension,
} from "./types";

/** Cada dimensión que puede hacer fallar una regla, en el orden en que se revisan. */
export type RuleDimension =
  | "user_ids"
  | "vendedor_ids"
  | "setter_ids"
  | "product_ids"
  | "variant_ids"
  | "financing_types"
  | "payment_methods"
  | "payment_types"
  | "channels"
  | "platforms"
  | "content_post_ids"
  | "meta_campaign_ids"
  | "meta_ad_ids"
  | `utm.${UtmDimension}`
  | "payment_number"
  | "sale_amount"
  | "validity";

export interface EvaluatedRole {
  /** La clave del rol. */
  role: string;
  ruleId: string | null;
  /** `false` = no se crea nada para este rol en este pago. */
  applies: boolean;
  /** Null con `applies = true` = «Sin persona» (la pieza no tiene responsable). */
  userId: string | null;
  baseCents: number;
  amountCents: number;
}

/** Un caso compartido con la función SQL (`rules.cases.json`). */
export interface RulesCase {
  name: string;
  roles: CommissionRole[];
  rules: CommissionRule[];
  facts: CommissionFacts;
  /** Uno por rol ACTIVO, en el orden de `roles`. */
  expected: EvaluatedRole[];
}

type RoleLike = Pick<CommissionRole, "payee">;

const list = <T>(value: readonly T[] | null | undefined): readonly T[] => (Array.isArray(value) ? value : []);

/** Sin mayúsculas ni espacios de más; los UTM a veces llegan codificados (`%20`, `+`). */
function norm(value: string | null | undefined): string {
  return (decodeUtm(value) ?? "").trim().toLowerCase();
}

/** Una lista vacía no limita; con valores, el dato tiene que estar (un dato ausente no cumple). */
function inList(values: readonly string[], actual: string | null | undefined): boolean {
  return values.length === 0 || (actual !== null && actual !== undefined && values.includes(actual));
}

const bound = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** Rango inclusivo; un extremo ausente no limita. */
function inRange(actual: number, min: number | null | undefined, max: number | null | undefined): boolean {
  if (bound(min) && actual < min) return false;
  if (bound(max) && actual > max) return false;
  return true;
}

/** La persona de la venta (o de la pieza) que corresponde al rol; con `fixed` no hay. */
function salePersonFor(role: RoleLike, facts: CommissionFacts): string | null {
  switch (role.payee) {
    case "sale_vendedor":
      return facts.sale.vendedor_id;
    case "sale_setter":
      return facts.sale.setter_id;
    case "content_assignee":
      return facts.content_assignee_id;
    default:
      return null;
  }
}

/** ¿El toque atribuido tiene pieza o publicación? */
function touchHasPiece(facts: CommissionFacts): boolean {
  const t = facts.touch;
  return !!t && !!(t.content_post_id || t.social_post_id);
}

/**
 * La primera dimensión que NO se cumple, o null si la regla matchea. Mismo recorrido que
 * `ruleMatches` (que es `firstFailedDimension(...) === null`).
 */
function firstFailedDimension(rule: Pick<CommissionRule, "conditions" | "valid_from" | "valid_until">, facts: CommissionFacts, role: RoleLike): RuleDimension | null {
  const c: RuleConditions = rule.conditions && typeof rule.conditions === "object" ? rule.conditions : {};
  const touch = facts.touch;

  const userIds = list(c.user_ids);
  if (userIds.length && role.payee !== "fixed" && !inList(userIds, salePersonFor(role, facts))) return "user_ids";
  if (!inList(list(c.vendedor_ids), facts.sale.vendedor_id)) return "vendedor_ids";
  if (!inList(list(c.setter_ids), facts.sale.setter_id)) return "setter_ids";
  if (!inList(list(c.product_ids), facts.sale.product_id)) return "product_ids";
  if (!inList(list(c.variant_ids), facts.sale.variant_id)) return "variant_ids";
  if (!inList(list(c.financing_types), facts.sale.financing_type)) return "financing_types";
  if (!inList(list(c.payment_methods), facts.payment.method)) return "payment_methods";
  if (!inList(list(c.payment_types), facts.payment.type)) return "payment_types";
  // Sin toque (o un toque sin canal) el canal es `direct`.
  if (!inList(list(c.channels), touch?.channel || "direct")) return "channels";

  const platforms = list(c.platforms).map(norm).filter(Boolean);
  if (platforms.length && !platforms.includes(norm(touch?.source))) return "platforms";

  if (!inList(list(c.content_post_ids), touch?.content_post_id)) return "content_post_ids";
  if (!inList(list(c.meta_campaign_ids), touch?.meta_campaign_id)) return "meta_campaign_ids";
  if (!inList(list(c.meta_ad_ids), touch?.meta_ad_id)) return "meta_ad_ids";

  for (const dim of UTM_DIMENSIONS) {
    const cond = c.utm?.[dim];
    const values = list(cond?.values).map(norm).filter(Boolean);
    if (!values.length) continue; // dimensión vacía = cualquiera
    const actual = touch ? norm(touch[dim]) : "";
    if (!actual) return `utm.${dim}`; // sin toque (o sin ese dato) ninguna condición utm se cumple
    const ok = cond?.op === "contains" ? values.some((v) => actual.includes(v)) : values.includes(actual);
    if (!ok) return `utm.${dim}`;
  }

  if (c.payment_number && !inRange(facts.payment.number, c.payment_number.from, c.payment_number.to)) return "payment_number";
  if (c.sale_amount && !inRange(toCents(facts.sale.final_amount), bound(c.sale_amount.min) ? toCents(c.sale_amount.min) : null, bound(c.sale_amount.max) ? toCents(c.sale_amount.max) : null)) {
    return "sale_amount";
  }

  const paidOn = facts.payment.paid_on;
  if (rule.valid_from && paidOn < rule.valid_from) return "validity";
  if (rule.valid_until && paidOn > rule.valid_until) return "validity";

  return null;
}

/** ¿Las condiciones de la regla se cumplen para este pago? (No mira si está activa: eso lo hace `pickRule`.) */
export function ruleMatches(rule: Pick<CommissionRule, "conditions" | "valid_from" | "valid_until">, facts: CommissionFacts, role: RoleLike): boolean {
  return firstFailedDimension(rule, facts, role) === null;
}

/** Para «Probar con una venta» (F58): si matchea y, si no, qué dimensión la dejó afuera. */
export function explainRule(
  rule: Pick<CommissionRule, "conditions" | "valid_from" | "valid_until">,
  facts: CommissionFacts,
  role: RoleLike,
): { matched: boolean; failedDimension: RuleDimension | null } {
  const failedDimension = firstFailedDimension(rule, facts, role);
  return { matched: failedDimension === null, failedDimension };
}

/**
 * A quién se le paga. `applies = false`: el rol no genera nada en este pago. `applies = true` con
 * `userId = null`: «Sin persona» (la pieza no tiene responsable).
 *
 *   sale_vendedor / sale_setter  la persona de la venta, pisada por `beneficiary_user_id`; sin ninguna, no aplica.
 *   content_assignee             el responsable de la pieza, pisado por `beneficiary_user_id`; si el toque no
 *                                tiene pieza ni publicación, no aplica (tampoco con beneficiario).
 *   fixed                        `beneficiary_user_id`; sin persona (salió del equipo), no aplica.
 */
export function payeeFor(
  role: RoleLike,
  rule: Pick<CommissionRule, "beneficiary_user_id">,
  facts: CommissionFacts,
): { applies: boolean; userId: string | null } {
  const override = rule.beneficiary_user_id || null;
  switch (role.payee) {
    case "sale_vendedor":
    case "sale_setter": {
      const userId = override ?? salePersonFor(role, facts);
      return { applies: userId !== null, userId };
    }
    case "content_assignee": {
      if (!touchHasPiece(facts)) return { applies: false, userId: null };
      return { applies: true, userId: override ?? facts.content_assignee_id ?? null };
    }
    case "fixed":
      return { applies: override !== null, userId: override };
    default:
      return { applies: false, userId: null };
  }
}

/** La primera regla (por `position`) del rol, activa, no archivada y que matchea; o null. */
export function pickRule(rules: readonly CommissionRule[], facts: CommissionFacts, role: Pick<CommissionRole, "key" | "payee">): CommissionRule | null {
  const candidates = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.role === role.key && rule.is_active && !rule.archived_at)
    .sort((a, b) => a.rule.position - b.rule.position || a.index - b.index);
  for (const { rule } of candidates) if (ruleMatches(rule, facts, role)) return rule;
  return null;
}

/** División entera redondeada (medio sube), sin flotantes: `n` y `d` enteros, `n >= 0`. */
function divRound(n: number, d: number): number {
  const twice = n * 2 + d;
  return (twice - (twice % (2 * d))) / (2 * d);
}

/**
 * Base y monto en céntimos.
 *   base `gross`        = lo cobrado.
 *   base `net_of_fees`  = lo cobrado − el fee del procesador (fee null = 0), nunca menor que 0.
 *   `percent`           = base × tasa / 100, con la tasa en milésimas enteras (2,125 % → 2125).
 *   `fixed`             = el monto fijo.
 * La base se informa siempre según `rule.base`, también en una regla de monto fijo.
 */
export function commissionAmount(
  rule: Pick<CommissionRule, "calc_type" | "rate" | "fixed_amount" | "base">,
  facts: CommissionFacts,
): { baseCents: number; amountCents: number } {
  const gross = toCents(facts.payment.amount);
  const baseCents = rule.base === "net_of_fees" ? Math.max(0, gross - toCents(facts.payment.fee_amount)) : gross;
  if (rule.calc_type === "fixed") return { baseCents, amountCents: toCents(rule.fixed_amount) };
  const milli = Math.max(0, Math.round((Number(rule.rate) || 0) * 1000));
  return { baseCents, amountCents: divRound(Math.max(0, baseCents) * milli, 100000) };
}

/** Qué genera un pago, por cada rol ACTIVO y en el orden de `roles`. No escribe nada. */
export function evaluatePayment(roles: readonly CommissionRole[], rules: readonly CommissionRule[], facts: CommissionFacts): EvaluatedRole[] {
  return roles
    .filter((role) => role.active)
    .map((role): EvaluatedRole => {
      const rule = pickRule(rules, facts, role);
      if (!rule) return { role: role.key, ruleId: null, applies: false, userId: null, baseCents: 0, amountCents: 0 };
      const payee = payeeFor(role, rule, facts);
      if (!payee.applies) return { role: role.key, ruleId: rule.id, applies: false, userId: null, baseCents: 0, amountCents: 0 };
      const { baseCents, amountCents } = commissionAmount(rule, facts);
      return { role: role.key, ruleId: rule.id, applies: true, userId: payee.userId, baseCents, amountCents };
    });
}
