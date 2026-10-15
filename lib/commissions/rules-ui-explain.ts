/**
 * «Probar con una venta» en palabras (F58). Puro: por qué una regla de arriba se quedó afuera y cómo se ve la
 * respuesta de cada rol. Usa los hechos reales del cobro (`facts`) para decir también QUÉ tiene esa venta, no solo
 * qué pedía la regla: «No es del producto Mentoría (esta venta es de Curso)».
 */
import { formatUsd } from "@/lib/finance/format";
import { FINANCING_TYPE_LABELS } from "@/lib/sales/labels";
import { toCents } from "@/lib/sales/money";
import type { DescribeLookups } from "./describe";
import type { CommissionPreviewRole, SkippedRule } from "./preview";
import { PREVIEW_REASON_MESSAGES } from "./preview";
import { shortCivil } from "./status";
import type { CommissionFacts, CommissionRule, UtmDimension } from "./types";

const UTM_LABELS: Record<UtmDimension, string> = { source: "La fuente", medium: "El medio", campaign: "La campaña", content: "El contenido", term: "El término" };
const CHANNEL_LABELS: Record<string, string> = { organic: "orgánico", paid: "pautado", referral: "referido", direct: "directo" };
const PAYMENT_TYPE_LABELS: Record<string, string> = { full: "un pago único", reservation: "una reserva", installment: "una cuota", refund: "un reembolso" };

const orList = (items: readonly string[]) => items.join(" o ");
const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const named = (ids: readonly string[] | undefined, map: Readonly<Record<string, string | undefined>> | undefined, fallback: string): string =>
  orList((ids ?? []).map((id) => map?.[id] ?? fallback));

/** «entre 2 y 4», «desde el 2», «hasta el 4», «exactamente el 3». */
function rangeText(from: number | null | undefined, to: number | null | undefined, format: (n: number) => string): string {
  const a = typeof from === "number" ? from : null;
  const b = typeof to === "number" ? to : null;
  if (a !== null && b !== null) return a === b ? `exactamente ${format(a)}` : `entre ${format(a)} y ${format(b)}`;
  if (a !== null) return `desde ${format(a)}`;
  if (b !== null) return `hasta ${format(b)}`;
  return "cualquiera";
}

function dateRange(rule: Pick<CommissionRule, "valid_from" | "valid_until">): string {
  if (rule.valid_from && rule.valid_until) return `del ${shortCivil(rule.valid_from)} al ${shortCivil(rule.valid_until)}`;
  if (rule.valid_from) return `desde el ${shortCivil(rule.valid_from)}`;
  if (rule.valid_until) return `hasta el ${shortCivil(rule.valid_until)}`;
  return "siempre";
}

/**
 * Por qué una regla no matcheó, en una frase. Si no tenemos la regla (se archivó mientras tanto) cae al texto
 * genérico del servidor.
 */
export function skipReasonText(skipped: SkippedRule, rule: CommissionRule | undefined, facts: CommissionFacts, lookups: DescribeLookups = {}): string {
  if (!rule) return skipped.reason;
  const c = rule.conditions ?? {};
  const touch = facts.touch;
  const pair = (negative: string, actual: string) => `${capital(negative)} (${actual})`;

  switch (skipped.dimension) {
    case "user_ids":
      return capital(`la persona no es ${named(c.user_ids, lookups.people, "otra persona")}`);
    case "vendedor_ids": {
      const actual = facts.sale.vendedor_id ? `en esta venta es ${lookups.people?.[facts.sale.vendedor_id] ?? "otra persona"}` : "esta venta no tiene vendedor";
      return pair(`el vendedor no es ${named(c.vendedor_ids, lookups.people, "otra persona")}`, actual);
    }
    case "setter_ids": {
      const actual = facts.sale.setter_id ? `en esta venta es ${lookups.people?.[facts.sale.setter_id] ?? "otra persona"}` : "esta venta no tiene setter";
      return pair(`el setter no es ${named(c.setter_ids, lookups.people, "otra persona")}`, actual);
    }
    case "product_ids": {
      const actual = facts.sale.product_id ? `esta venta es de ${lookups.products?.[facts.sale.product_id] ?? "otro producto"}` : "esta venta no tiene producto";
      return pair(`no es del producto ${named(c.product_ids, lookups.products, "otro producto")}`, actual);
    }
    case "variant_ids": {
      const actual = facts.sale.variant_id ? `esta venta es de ${lookups.variants?.[facts.sale.variant_id] ?? "otra variante"}` : "esta venta no tiene variante";
      return pair(`no es de la variante ${named(c.variant_ids, lookups.variants, "otra variante")}`, actual);
    }
    case "financing_types": {
      const label = (k: string) => (FINANCING_TYPE_LABELS as Record<string, string>)[k]?.toLowerCase() ?? k;
      return pair(`el financiamiento no es ${orList((c.financing_types ?? []).map(label))}`, `esta venta es ${label(facts.sale.financing_type)}`);
    }
    case "payment_methods": {
      const actual = facts.payment.method ? `este cobro fue por ${lookups.methods?.[facts.payment.method] ?? facts.payment.method}` : "este cobro no tiene método";
      return pair(`el método no es ${named(c.payment_methods, lookups.methods, "otro método")}`, actual);
    }
    case "payment_types": {
      const label = (k: string) => PAYMENT_TYPE_LABELS[k] ?? k;
      return pair(`el pago no es ${orList((c.payment_types ?? []).map(label))}`, `este cobro es ${label(String(facts.payment.type))}`);
    }
    case "channels": {
      const label = (k: string) => CHANNEL_LABELS[k] ?? k;
      const channel = touch?.channel || "direct";
      return pair(`el canal no es ${orList((c.channels ?? []).map(label))}`, touch ? `esta venta llegó por un canal ${label(channel)}` : "esta venta no tiene atribución, cuenta como directa");
    }
    case "platforms":
      return pair(`la red no es ${orList((c.platforms ?? []).map(capital))}`, touch?.source ? `la fuente de esta venta es ${touch.source}` : "esta venta no trae fuente");
    case "content_post_ids":
      return pair(`no viene de la pieza ${named(c.content_post_ids, lookups.posts, "una pieza puntual")}`, touch?.content_post_id ? "viene de otra pieza" : "no viene de una pieza");
    case "meta_campaign_ids":
      return pair(`no viene de la campaña de Meta ${named(c.meta_campaign_ids, lookups.metaCampaigns, "otra campaña")}`, touch?.meta_campaign_id ? "viene de otra campaña" : "no viene de una campaña de Meta");
    case "meta_ad_ids":
      return pair(`no viene del anuncio de Meta ${named(c.meta_ad_ids, lookups.metaAds, "otro anuncio")}`, touch?.meta_ad_id ? "viene de otro anuncio" : "no viene de un anuncio de Meta");
    case "utm.source":
    case "utm.medium":
    case "utm.campaign":
    case "utm.content":
    case "utm.term": {
      const dim = skipped.dimension.slice(4) as UtmDimension;
      const cond = c.utm?.[dim];
      const values = orList((cond?.values ?? []).map((v) => `«${v}»`));
      const actual = touch?.[dim];
      return pair(`${UTM_LABELS[dim].toLowerCase()} ${cond?.op === "contains" ? "no contiene" : "no es"} ${values}`, actual ? `esta venta trae «${actual}»` : `esta venta no trae ${UTM_LABELS[dim].toLowerCase().replace(/^la |^el /, "")}`);
    }
    case "payment_number":
      return pair(`el número de pago no está ${rangeText(c.payment_number?.from, c.payment_number?.to, (n) => `el ${n}`)}`, `este es el pago ${facts.payment.number}`);
    case "sale_amount":
      return pair(`el monto de la venta no está ${rangeText(c.sale_amount?.min, c.sale_amount?.max, (n) => formatUsd(toCents(n)))}`, `esta venta es de ${formatUsd(toCents(facts.sale.final_amount))}`);
    case "validity":
      return pair(`la regla vale ${dateRange(rule)}`, `este cobro es del ${shortCivil(facts.payment.paid_on)}`);
    default:
      return skipped.reason;
  }
}

// ── La respuesta de cada rol ────────────────────────────────────────────

export type PreviewTone = "pays" | "warn" | "none";

export interface PreviewRoleView {
  key: string;
  roleName: string;
  tone: PreviewTone;
  /** «Ana cobraría USD 38,82». */
  headline: string;
  /** «Regla «Vendedor 12 %» (lugar 2)» + base. */
  detail: string | null;
  draft: boolean;
  skipped: Array<{ id: string; title: string; text: string }>;
}

/** Cómo se muestra el resultado de un rol. */
export function previewRoleView(role: CommissionPreviewRole, rulesById: ReadonlyMap<string, CommissionRule>, facts: CommissionFacts, lookups: DescribeLookups = {}): PreviewRoleView {
  const skipped = role.skipped.map((s) => ({ id: s.ruleId, title: `${s.name || "Regla"} (lugar ${s.position})`, text: skipReasonText(s, rulesById.get(s.ruleId), facts, lookups) }));
  const detail = role.rule
    ? `Gana «${role.rule.name || "Regla"}» (lugar ${role.rule.position}) · base ${formatUsd(role.baseCents)}${role.rule.holdDays > 0 ? ` · se retiene ${role.rule.holdDays} ${role.rule.holdDays === 1 ? "día" : "días"}` : ""}`
    : null;
  const draft = !!role.rule?.draft;

  if (role.applies) {
    const who = role.userName ?? (role.userId ? "Una persona del equipo" : null);
    return {
      key: role.roleKey,
      roleName: role.roleName,
      tone: role.reason === "no_person" ? "warn" : "pays",
      headline: who ? `${who} cobraría ${formatUsd(role.amountCents)}` : `Quedaría «Sin persona» (${formatUsd(role.amountCents)})`,
      detail,
      draft,
      skipped,
    };
  }
  const reason = role.reason ?? "no_rule";
  return {
    key: role.roleKey,
    roleName: role.roleName,
    tone: reason === "no_rule" ? "none" : "warn",
    headline: reason === "no_rule" ? "No genera comisión" : PREVIEW_REASON_MESSAGES[reason],
    detail: reason === "no_rule" ? PREVIEW_REASON_MESSAGES.no_rule : detail,
    draft,
    skipped,
  };
}

/** Una línea con los datos del cobro que se probó, para que se entienda contra qué se compararon las reglas. */
export function factsSummary(facts: CommissionFacts, lookups: DescribeLookups = {}): string {
  const parts: string[] = [];
  parts.push(`${formatUsd(toCents(facts.payment.amount))}${facts.payment.number ? ` · pago ${facts.payment.number}` : ""}`);
  if (facts.sale.product_id) parts.push(lookups.products?.[facts.sale.product_id] ?? "producto de la venta");
  if (facts.payment.method) parts.push(lookups.methods?.[facts.payment.method] ?? facts.payment.method);
  parts.push(`canal ${CHANNEL_LABELS[facts.touch?.channel || "direct"] ?? "directo"}`);
  if (facts.touch?.source) parts.push(facts.touch.source);
  return parts.join(" · ");
}
