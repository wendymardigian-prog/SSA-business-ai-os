/**
 * El editor de reglas en palabras (F57). Puro: la frase de cada regla, el estado, el aviso «nunca se usa» y el
 * reordenamiento (arrastre y teclado). Los componentes solo componen estas funciones.
 *
 *   describeRule  «Vendedor · Mentoría · en cuotas · método Whop · 12 % del neto · desde el 1/11»
 *                 «Marketing · campaña contiene «webinar» · 2 % del cobrado · a Carla»
 */
import { formatUsd } from "@/lib/finance/format";
import { toCents } from "@/lib/shared/money";
import { shortCivil } from "./status";
import { UTM_DIMENSIONS, type CommissionRule, type RuleConditions, type UtmCondition, type UtmDimension } from "./types";

type Names = Readonly<Record<string, string | undefined>>;

/** Nombres para traducir los ids de la regla a palabras. Lo que falta se dice en genérico. */
export interface DescribeLookups {
  /** Clave del rol → su nombre. */
  roles?: Names;
  /** Id de producto → nombre. */
  products?: Names;
  variants?: Names;
  /** Id de persona → nombre. */
  people?: Names;
  /** Clave del método de pago → nombre. */
  methods?: Names;
  /** Id de pieza → título. */
  posts?: Names;
  metaCampaigns?: Names;
  metaAds?: Names;
}

const UTM_LABELS: Record<UtmDimension, string> = { source: "fuente", medium: "medio", campaign: "campaña", content: "contenido", term: "término" };
const FINANCING_LABELS: Record<string, string> = {
  installments: "en cuotas",
  full: "de contado",
  reservation_installments: "con reserva y cuotas",
  subscription: "suscripción",
};
const PAYMENT_TYPE_LABELS: Record<string, string> = { full: "pago único", reservation: "reserva", installment: "cuota" };
const CHANNEL_LABELS: Record<string, string> = { organic: "orgánico", paid: "pautado", referral: "referido", direct: "directo" };

const orList = (items: string[]): string => items.join(" o ");
const nonEmpty = <T>(v: readonly T[] | undefined | null): readonly T[] => (Array.isArray(v) ? v : []);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** `2.125` → `2,125`; `12` → `12`; sin ceros de más. */
export function formatRate(rate: number): string {
  const text = String(Math.round(rate * 1000) / 1000);
  return text.replace(".", ",");
}

function describeUtm(dim: UtmDimension, cond: UtmCondition | undefined): string | null {
  const values = nonEmpty(cond?.values).map((v) => v.trim()).filter(Boolean);
  if (!values.length) return null;
  const quoted = orList(values.map((v) => `«${v}»`));
  return `${UTM_LABELS[dim]} ${cond?.op === "contains" ? "contiene" : "es"} ${quoted}`;
}

function describeNumber(c: RuleConditions): string | null {
  const from = c.payment_number?.from ?? null;
  const to = c.payment_number?.to ?? null;
  if (from !== null && to !== null) return from === to ? `solo el pago ${from}` : `pagos del ${from} al ${to}`;
  if (from !== null) return `desde el pago ${from}`;
  if (to !== null) return `hasta el pago ${to}`;
  return null;
}

function describeAmount(c: RuleConditions): string | null {
  const min = c.sale_amount?.min ?? null;
  const max = c.sale_amount?.max ?? null;
  if (min !== null && max !== null) return `venta de ${formatUsd(toCents(min))} a ${formatUsd(toCents(max))}`;
  if (min !== null) return `venta desde ${formatUsd(toCents(min))}`;
  if (max !== null) return `venta hasta ${formatUsd(toCents(max))}`;
  return null;
}

/** Las condiciones en palabras, en el orden Venta · Pago · Origen. */
export function describeConditions(conditions: RuleConditions | null | undefined, lookups: DescribeLookups = {}): string[] {
  const c = conditions ?? {};
  const out: string[] = [];
  const named = (ids: readonly string[] | undefined, names: Names | undefined, fallback: string) =>
    nonEmpty(ids).map((id) => names?.[id] ?? fallback);
  const push = (text: string | null | undefined) => {
    if (text) out.push(text);
  };

  // Venta
  const users = named(c.user_ids, lookups.people, "otra persona");
  if (users.length) push(`persona ${orList(users)}`);
  const vendedores = named(c.vendedor_ids, lookups.people, "otra persona");
  if (vendedores.length) push(`ventas de ${orList(vendedores)}`);
  const setters = named(c.setter_ids, lookups.people, "otra persona");
  if (setters.length) push(`setter ${orList(setters)}`);
  const products = named(c.product_ids, lookups.products, "otro producto");
  if (products.length) push(orList(products));
  const variants = named(c.variant_ids, lookups.variants, "otra variante");
  if (variants.length) push(`variante ${orList(variants)}`);
  const financing = nonEmpty(c.financing_types).map((f) => FINANCING_LABELS[f] ?? f);
  if (financing.length) push(orList(financing));
  push(describeAmount(c));

  // Pago
  const methods = nonEmpty(c.payment_methods).map((m) => lookups.methods?.[m] ?? m);
  if (methods.length) push(`${methods.length > 1 ? "métodos" : "método"} ${orList(methods)}`);
  const types = nonEmpty(c.payment_types).map((t) => PAYMENT_TYPE_LABELS[t] ?? t);
  if (types.length) push(orList(types));
  push(describeNumber(c));

  // Origen
  const channels = nonEmpty(c.channels).map((ch) => CHANNEL_LABELS[ch] ?? ch);
  if (channels.length) push(`canal ${orList(channels)}`);
  const platforms = nonEmpty(c.platforms).map((p) => cap(p.trim()));
  if (platforms.length) push(`red ${orList(platforms)}`);
  const posts = named(c.content_post_ids, lookups.posts, "una pieza puntual");
  if (posts.length) push(`pieza ${orList(posts)}`);
  const campaigns = named(c.meta_campaign_ids, lookups.metaCampaigns, "otra campaña");
  if (campaigns.length) push(`campaña de Meta ${orList(campaigns)}`);
  const ads = named(c.meta_ad_ids, lookups.metaAds, "otro anuncio");
  if (ads.length) push(`anuncio de Meta ${orList(ads)}`);
  for (const dim of UTM_DIMENSIONS) push(describeUtm(dim, c.utm?.[dim]));

  return out;
}

/** La frase de una regla. */
export function describeRule(rule: CommissionRule, lookups: DescribeLookups = {}): string {
  const parts: string[] = [lookups.roles?.[rule.role] ?? rule.role, ...describeConditions(rule.conditions, lookups)];

  if (rule.calc_type === "fixed") parts.push(`${formatUsd(toCents(rule.fixed_amount))} fijos`);
  else parts.push(`${formatRate(Number(rule.rate) || 0)} % del ${rule.base === "net_of_fees" ? "neto" : "cobrado"}`);

  if (rule.hold_days > 0) parts.push(`retiene ${rule.hold_days} ${rule.hold_days === 1 ? "día" : "días"}`);

  if (rule.valid_from && rule.valid_until) parts.push(`del ${shortCivil(rule.valid_from)} al ${shortCivil(rule.valid_until)}`);
  else if (rule.valid_from) parts.push(`desde el ${shortCivil(rule.valid_from)}`);
  else if (rule.valid_until) parts.push(`hasta el ${shortCivil(rule.valid_until)}`);

  if (rule.beneficiary_user_id) parts.push(`a ${lookups.people?.[rule.beneficiary_user_id] ?? "una persona fija"}`);
  return parts.join(" · ");
}

export type RuleState = "activa" | "pausada" | "vencida" | "archivada";

export const RULE_STATES: Record<RuleState, { label: string }> = {
  activa: { label: "Activa" },
  pausada: { label: "Pausada" },
  vencida: { label: "Vencida" },
  archivada: { label: "Archivada" },
};

/** Activa · Pausada · Vencida (la vigencia ya terminó). Una que todavía no empezó sigue siendo Activa. */
export function ruleState(rule: Pick<CommissionRule, "is_active" | "archived_at" | "valid_until">, todayLocal: string): RuleState {
  if (rule.archived_at) return "archivada";
  if (!rule.is_active) return "pausada";
  if (rule.valid_until && rule.valid_until < todayLocal) return "vencida";
  return "activa";
}

// ---------------------------------------------------------------------------------------------------------
// «Nunca se usa»
// ---------------------------------------------------------------------------------------------------------

const norm = (s: string) => s.trim().toLowerCase();

/** ¿Los valores de `b` están todos dentro de `a`? `a` vacío no limita; `b` vacío con `a` limitando, no. */
function listCovers(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const la = nonEmpty(a);
  if (!la.length) return true;
  const lb = nonEmpty(b);
  return lb.length > 0 && lb.every((v) => la.includes(v));
}

function utmCovers(a: UtmCondition | undefined, b: UtmCondition | undefined): boolean {
  const va = nonEmpty(a?.values).map(norm).filter(Boolean);
  if (!va.length) return true;
  const vb = nonEmpty(b?.values).map(norm).filter(Boolean);
  if (!vb.length) return false;
  if (a?.op === "contains") return vb.every((v) => va.some((x) => v.includes(x)));
  // `a` es «es igual a»: solo cubre a otro «es igual a» con valores que ya estaban.
  return b?.op !== "contains" && vb.every((v) => va.includes(v));
}

/** El rango `a` contiene al rango `b` (un extremo ausente = sin límite). */
function rangeCovers(a: Array<number | null | undefined>, b: Array<number | null | undefined>): boolean {
  const [aMin, aMax] = a;
  const [bMin, bMax] = b;
  if (aMin != null && (bMin == null || bMin < aMin)) return false;
  if (aMax != null && (bMax == null || bMax > aMax)) return false;
  return true;
}

function dateRangeCovers(a: Pick<CommissionRule, "valid_from" | "valid_until">, b: Pick<CommissionRule, "valid_from" | "valid_until">): boolean {
  if (a.valid_from && (!b.valid_from || b.valid_from < a.valid_from)) return false;
  if (a.valid_until && (!b.valid_until || b.valid_until > a.valid_until)) return false;
  return true;
}

/** ¿Todo pago que cumple `b` cumple también `a`? (a es igual o más amplia en cada dimensión.) */
function ruleCovers(a: CommissionRule, b: CommissionRule): boolean {
  const ca: RuleConditions = a.conditions ?? {};
  const cb: RuleConditions = b.conditions ?? {};
  const lists: Array<keyof RuleConditions> = [
    "user_ids", "vendedor_ids", "setter_ids", "product_ids", "variant_ids", "financing_types", "payment_methods", "payment_types",
    "channels", "content_post_ids", "meta_campaign_ids", "meta_ad_ids",
  ];
  for (const key of lists) if (!listCovers(ca[key] as string[] | undefined, cb[key] as string[] | undefined)) return false;
  if (!listCovers(nonEmpty(ca.platforms).map(norm), nonEmpty(cb.platforms).map(norm))) return false;
  for (const dim of UTM_DIMENSIONS) if (!utmCovers(ca.utm?.[dim], cb.utm?.[dim])) return false;
  if (!rangeCovers([ca.payment_number?.from, ca.payment_number?.to], [cb.payment_number?.from, cb.payment_number?.to])) return false;
  if (!rangeCovers([ca.sale_amount?.min, ca.sale_amount?.max], [cb.sale_amount?.min, cb.sale_amount?.max])) return false;
  return dateRangeCovers(a, b);
}

/**
 * Aviso «nunca se usa»: una regla de arriba (del mismo rol, activa y no archivada) que no es más estricta que
 * esta en ninguna dimensión se queda con todos los pagos antes de que esta se mire. Una regla pausada o
 * archivada no avisa (ya no se usa por otra razón).
 */
export function isShadowed(rule: CommissionRule, rulesAbove: readonly CommissionRule[]): boolean {
  if (!rule.is_active || rule.archived_at) return false;
  return rulesAbove.some((above) => above.id !== rule.id && above.role === rule.role && above.is_active && !above.archived_at && ruleCovers(above, rule));
}

// ---------------------------------------------------------------------------------------------------------
// Ordenar
// ---------------------------------------------------------------------------------------------------------

/** Mueve el elemento de la posición `from` a la posición `to` (0-based). No muta; índices fuera de rango devuelven una copia igual. */
export function reorder<T>(ids: readonly T[], from: number, to: number): T[] {
  const out = [...ids];
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

export interface KeyboardMove<T> {
  ids: T[];
  /** Dónde queda el foco. */
  focusIndex: number;
  /** `true` si el orden cambió. */
  moved: boolean;
}

/**
 * Teclado de la lista ordenable: ↑/↓ mueven el foco; Alt+↑/↓ mueven la regla. En el borde no pasa nada
 * (el foco se queda). Cualquier otra tecla devuelve null (quien llama no tiene que frenar el evento).
 */
export function moveByKeyboard<T>(ids: readonly T[], index: number, event: { key: string; altKey?: boolean }): KeyboardMove<T> | null {
  const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
  if (!delta || index < 0 || index >= ids.length) return null;
  const target = index + delta;
  if (target < 0 || target >= ids.length) return { ids: [...ids], focusIndex: index, moved: false };
  if (!event.altKey) return { ids: [...ids], focusIndex: target, moved: false };
  return { ids: reorder(ids, index, target), focusIndex: target, moved: true };
}

/** Las posiciones 1..N que se guardan después de ordenar. */
export function positionsFor<T>(ids: readonly T[]): Array<{ id: T; position: number }> {
  return ids.map((id, i) => ({ id, position: i + 1 }));
}
