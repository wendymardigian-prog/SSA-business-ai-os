/**
 * El borrador del formulario de una regla (F57). Puro: pasa de la regla guardada a lo que se edita (textos, listas),
 * y de lo que se edita a lo que espera `createCommissionRule` / `updateCommissionRule` / `previewCommissions`.
 *
 * Se valida con `commissionRuleInputSchema(role)`, la MISMA función que usa el servidor, así que los mensajes
 * son los que vería la acción. Los números se escriben como texto (para poder tipear «12,5»): acá se pasan a
 * número y, si un texto no es un número, se dice en el campo y no se manda nada.
 */
import { describeRule, type DescribeLookups } from "./describe";
import { commissionRuleInputSchema, cleanConditions, MAX_UTM_VALUES, type CommissionRuleInput } from "./rule-schema";
import {
  UTM_DIMENSIONS,
  type CommissionBase,
  type CommissionCalcType,
  type CommissionRole,
  type CommissionRule,
  type RuleConditions,
  type UtmDimension,
  type UtmOp,
} from "./types";

export interface UtmDraft {
  op: UtmOp;
  values: string[];
}

export interface RuleDraft {
  /** null = regla nueva. */
  id: string | null;
  role: string;
  name: string;
  /** Una condición vieja («la persona del rol»): el formulario no la edita, pero la conserva al guardar. */
  userIds: string[];
  vendedorIds: string[];
  setterIds: string[];
  productIds: string[];
  variantIds: string[];
  financingTypes: string[];
  saleAmountMin: string;
  saleAmountMax: string;
  paymentMethods: string[];
  paymentTypes: string[];
  paymentNumberFrom: string;
  paymentNumberTo: string;
  channels: string[];
  platforms: string[];
  contentPostIds: string[];
  metaCampaignIds: string[];
  metaAdIds: string[];
  utm: Record<UtmDimension, UtmDraft>;
  calcType: CommissionCalcType;
  rate: string;
  fixedAmount: string;
  base: CommissionBase;
  /** "" = la persona de la venta (o de la pieza). */
  beneficiaryUserId: string;
  holdDays: string;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
  /** El `updated_at` con el que se abrió, para avisar si alguien la cambió mientras tanto. */
  updatedAt: string | null;
}

const emptyUtm = (): Record<UtmDimension, UtmDraft> => ({
  source: { op: "equals", values: [] },
  medium: { op: "equals", values: [] },
  campaign: { op: "equals", values: [] },
  content: { op: "equals", values: [] },
  term: { op: "equals", values: [] },
});

/**
 * Una regla nueva, vacía. La PRIMERA regla de un rol de pieza se propone para lo orgánico y la del rol «Pauta»
 * para lo pautado; se pueden cambiar. Sin esa condición una regla de contenido también cobraría ventas de anuncios.
 */
export function emptyRuleDraft(role: Pick<CommissionRole, "key" | "payee">, existingRules: number): RuleDraft {
  const first = existingRules === 0;
  return {
    id: null,
    role: role.key,
    name: "",
    userIds: [],
    vendedorIds: [],
    setterIds: [],
    productIds: [],
    variantIds: [],
    financingTypes: [],
    saleAmountMin: "",
    saleAmountMax: "",
    paymentMethods: [],
    paymentTypes: [],
    paymentNumberFrom: "",
    paymentNumberTo: "",
    channels: first && role.key === "pauta" ? ["paid"] : first && role.payee === "content_assignee" ? ["organic"] : [],
    platforms: [],
    contentPostIds: [],
    metaCampaignIds: [],
    metaAdIds: [],
    utm: emptyUtm(),
    calcType: "percent",
    rate: "",
    fixedAmount: "",
    base: "gross",
    beneficiaryUserId: "",
    holdDays: "0",
    validFrom: "",
    validUntil: "",
    isActive: true,
    updatedAt: null,
  };
}

const text = (n: number | null | undefined): string => (n === null || n === undefined || !Number.isFinite(n) ? "" : String(n));

/** La regla guardada como borrador editable. */
export function draftFromRule(rule: CommissionRule, updatedAt: string | null): RuleDraft {
  const c = rule.conditions ?? {};
  const utm = emptyUtm();
  for (const dim of UTM_DIMENSIONS) {
    const cond = c.utm?.[dim];
    if (cond) utm[dim] = { op: cond.op === "contains" ? "contains" : "equals", values: [...(cond.values ?? [])] };
  }
  return {
    id: rule.id,
    role: rule.role,
    name: rule.name,
    userIds: [...(c.user_ids ?? [])],
    vendedorIds: [...(c.vendedor_ids ?? [])],
    setterIds: [...(c.setter_ids ?? [])],
    productIds: [...(c.product_ids ?? [])],
    variantIds: [...(c.variant_ids ?? [])],
    financingTypes: [...(c.financing_types ?? [])],
    saleAmountMin: text(c.sale_amount?.min),
    saleAmountMax: text(c.sale_amount?.max),
    paymentMethods: [...(c.payment_methods ?? [])],
    paymentTypes: [...(c.payment_types ?? [])],
    paymentNumberFrom: text(c.payment_number?.from),
    paymentNumberTo: text(c.payment_number?.to),
    channels: [...(c.channels ?? [])],
    platforms: [...(c.platforms ?? [])],
    contentPostIds: [...(c.content_post_ids ?? [])],
    metaCampaignIds: [...(c.meta_campaign_ids ?? [])],
    metaAdIds: [...(c.meta_ad_ids ?? [])],
    utm,
    calcType: rule.calc_type,
    rate: text(rule.rate),
    fixedAmount: text(rule.fixed_amount),
    base: rule.base,
    beneficiaryUserId: rule.beneficiary_user_id ?? "",
    holdDays: String(rule.hold_days ?? 0),
    validFrom: rule.valid_from ?? "",
    validUntil: rule.valid_until ?? "",
    isActive: rule.is_active,
    updatedAt,
  };
}

// ── Números escritos a mano ─────────────────────────────────────────────

export type ParsedNumber = { ok: true; value: number | null } | { ok: false };

/**
 * «12,5» y «12.5» son 12,5; «1.250,75» es 1250,75 (si hay las dos, el último separador es el decimal). Vacío es
 * «sin valor». Cualquier otra cosa («doce», «1,2,3») no es un número.
 */
export function parseDecimal(raw: string): ParsedNumber {
  const t = raw.trim().replace(/\s+/g, "");
  if (t === "") return { ok: true, value: null };
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  let normalized = t;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    normalized = t.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    normalized = t.replace(",", ".");
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return { ok: false };
  const value = Number(normalized);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

/** Un entero escrito a mano (días, número de pago). */
export function parseWhole(raw: string): ParsedNumber {
  const n = parseDecimal(raw);
  if (!n.ok || n.value === null) return n;
  return Number.isInteger(n.value) ? n : { ok: false };
}

/** Dólares escritos a mano → céntimos enteros (null si no es un monto). */
export function usdTextToCents(raw: string): number | null {
  const n = parseDecimal(raw);
  if (!n.ok || n.value === null) return null;
  return Math.round(n.value * 100);
}

// ── Del borrador a lo que espera el servidor ────────────────────────────

export type DraftErrors = Record<string, string>;

const NOT_A_NUMBER = "Poné un número (por ejemplo 12,5)";
const NOT_A_WHOLE = "Poné un número entero";

function conditionsOf(draft: RuleDraft, errors: DraftErrors): RuleConditions {
  const c: Record<string, unknown> = {};
  const list = (key: string, values: string[]) => {
    if (values.length) c[key] = values;
  };
  list("user_ids", draft.userIds);
  list("vendedor_ids", draft.vendedorIds);
  list("setter_ids", draft.setterIds);
  list("product_ids", draft.productIds);
  list("variant_ids", draft.variantIds);
  list("financing_types", draft.financingTypes);
  list("payment_methods", draft.paymentMethods);
  list("payment_types", draft.paymentTypes);
  list("channels", draft.channels);
  list("platforms", draft.platforms);
  list("content_post_ids", draft.contentPostIds);
  list("meta_campaign_ids", draft.metaCampaignIds);
  list("meta_ad_ids", draft.metaAdIds);

  const min = parseDecimal(draft.saleAmountMin);
  const max = parseDecimal(draft.saleAmountMax);
  if (!min.ok || !max.ok) errors["conditions.sale_amount"] = NOT_A_NUMBER;
  else if (min.value !== null || max.value !== null) c.sale_amount = { min: min.value, max: max.value };

  const from = parseWhole(draft.paymentNumberFrom);
  const to = parseWhole(draft.paymentNumberTo);
  if (!from.ok || !to.ok) errors["conditions.payment_number"] = NOT_A_WHOLE;
  else if (from.value !== null || to.value !== null) c.payment_number = { from: from.value, to: to.value };

  const utm: Record<string, unknown> = {};
  for (const dim of UTM_DIMENSIONS) {
    const d = draft.utm[dim];
    if (d.values.length) utm[dim] = { op: d.op, values: d.values };
  }
  if (Object.keys(utm).length) c.utm = utm;
  return c as RuleConditions;
}

/** Lo que se manda a la acción, con los números ya convertidos. Los textos que no son números quedan en `errors`. */
export function draftToInput(draft: RuleDraft): { input: Record<string, unknown>; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const conditions = conditionsOf(draft, errors);

  let rate: number | null = null;
  let fixedAmount: number | null = null;
  if (draft.calcType === "percent") {
    const r = parseDecimal(draft.rate);
    if (!r.ok) errors.rate = NOT_A_NUMBER;
    else rate = r.value;
  } else {
    const f = parseDecimal(draft.fixedAmount);
    if (!f.ok) errors.fixedAmount = NOT_A_NUMBER;
    else fixedAmount = f.value;
  }
  const hold = parseWhole(draft.holdDays);
  if (!hold.ok) errors.holdDays = NOT_A_WHOLE;

  return {
    errors,
    input: {
      name: draft.name,
      role: draft.role,
      conditions,
      calcType: draft.calcType,
      rate,
      fixedAmount,
      base: draft.base,
      beneficiaryUserId: draft.beneficiaryUserId || null,
      holdDays: hold.ok ? (hold.value ?? 0) : 0,
      validFrom: draft.validFrom || null,
      validUntil: draft.validUntil || null,
      isActive: draft.isActive,
    },
  };
}

/** La clave del campo al que pertenece un error del esquema (`rate`, `conditions.payment_number`, `conditions.utm.source`…). */
function errorKey(path: ReadonlyArray<PropertyKey>): string {
  const parts = path.map(String);
  if (parts[0] !== "conditions") return parts[0] ?? "form";
  if (parts[1] === "utm" && parts[2]) return `conditions.utm.${parts[2]}`;
  return parts[1] ? `conditions.${parts[1]}` : "conditions";
}

export type DraftValidation =
  | { ok: true; input: CommissionRuleInput }
  | { ok: false; errors: DraftErrors; message: string };

/** Valida con el mismo esquema que el servidor. El mensaje es el primero que vería quien guarda. */
export function validateRuleDraft(draft: RuleDraft, role: Pick<CommissionRole, "payee">): DraftValidation {
  const { input, errors } = draftToInput(draft);
  if (Object.keys(errors).length > 0) return { ok: false, errors, message: Object.values(errors)[0] };

  const parsed = commissionRuleInputSchema(role).safeParse(input);
  if (parsed.success) return { ok: true, input: parsed.data };

  const out: DraftErrors = {};
  for (const issue of parsed.error.issues) {
    const key = errorKey(issue.path);
    if (!out[key]) out[key] = issue.message;
  }
  return { ok: false, errors: out, message: parsed.error.issues[0]?.message ?? "Los datos de la regla no son válidos" };
}

/** La regla validada con la forma que `previewCommissions` espera en `draftRules` (como si ya estuviera guardada). */
export function previewRuleFrom(input: CommissionRuleInput, args: { id: string; position: number }): Record<string, unknown> {
  return {
    id: args.id,
    name: input.name,
    role: input.role,
    position: args.position,
    conditions: input.conditions,
    calc_type: input.calcType,
    rate: input.rate,
    fixed_amount: input.fixedAmount,
    base: input.base,
    beneficiary_user_id: input.beneficiaryUserId,
    hold_days: input.holdDays,
    valid_from: input.validFrom,
    valid_until: input.validUntil,
    // Para probarla, siempre activa: una pausada no daría ninguna respuesta.
    is_active: true,
    archived_at: null,
  };
}

/** El mismo id que usa `previewRuleFrom` para una regla que todavía no existe. */
export const NEW_RULE_PREVIEW_ID = "regla-nueva";

// ── Cambios sin guardar y la frase en vivo ──────────────────────────────

export function isDraftDirty(initial: RuleDraft, current: RuleDraft): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current);
}

/** La frase de la regla tal como está en el formulario (lo que no se puede leer todavía se deja afuera). */
export function describeDraft(draft: RuleDraft, lookups: DescribeLookups): string {
  const errors: DraftErrors = {};
  const conditions = cleanConditions(conditionsOf(draft, errors));
  const rate = parseDecimal(draft.rate);
  const fixed = parseDecimal(draft.fixedAmount);
  const hold = parseWhole(draft.holdDays);
  const rule: CommissionRule = {
    id: draft.id ?? NEW_RULE_PREVIEW_ID,
    name: draft.name,
    role: draft.role,
    position: 1,
    conditions,
    calc_type: draft.calcType,
    rate: rate.ok ? rate.value : null,
    fixed_amount: fixed.ok ? fixed.value : null,
    base: draft.base,
    beneficiary_user_id: draft.beneficiaryUserId || null,
    hold_days: hold.ok ? (hold.value ?? 0) : 0,
    valid_from: draft.validFrom || null,
    valid_until: draft.validUntil || null,
    is_active: draft.isActive,
    archived_at: null,
  };
  return describeRule(rule, lookups);
}

// ── Listas de valores sueltos (UTM, ids de Meta) ────────────────────────

/**
 * Suma lo que se escribió (separado por comas o saltos de línea) a una lista, sin repetidos (sin importar
 * mayúsculas) y con un tope. Un valor más largo que `maxLength` se descarta y se avisa.
 */
export function addTokens(
  current: readonly string[],
  typed: string,
  opts: { max?: number; maxLength?: number; pattern?: RegExp } = {},
): { values: string[]; rejected: string[] } {
  const max = opts.max ?? MAX_UTM_VALUES;
  const maxLength = opts.maxLength ?? 200;
  const values = [...current];
  const seen = new Set(values.map((v) => v.toLowerCase()));
  const rejected: string[] = [];
  for (const part of typed.split(/[,\n]/)) {
    const token = part.trim();
    if (!token || seen.has(token.toLowerCase())) continue;
    if (token.length > maxLength || (opts.pattern && !opts.pattern.test(token)) || values.length >= max) {
      rejected.push(token);
      continue;
    }
    seen.add(token.toLowerCase());
    values.push(token);
  }
  return { values, rejected };
}

// ── Conflictos de edición ───────────────────────────────────────────────

/** ¿El error de guardar dice que alguien cambió la regla mientras se editaba? (Los dos textos de `updateCommissionRule`.) */
export function isEditConflict(message: string | null | undefined): boolean {
  return !!message && /mientras (la )?(editabas|tocabas)/i.test(message);
}
