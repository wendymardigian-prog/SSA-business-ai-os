// @plantilla-quitar(ventas)
/**
 * A quién queda asignado un contacto cuando entra por el link de un afiliado (F72). Puro; la gemela SQL es
 * `public.affiliate_assign_plan` (S13) y las dos corren `affiliate-assign.cases.json`.
 *
 *  1. Código inexistente o del mismo contacto → nada.
 *  2. El contacto ya era cliente → nada.
 *  3. Tipo: «lo trajo» (`originated`) si es su primer toque y el contacto nació con él (hasta 10 minutos antes);
 *     si no, «influyó» (`influenced`).
 *  4. Sin afiliado vigente → se asigna. Vence: originated → asignación + N meses (null = de por vida);
 *     influenced → toque + N días.
 *  5. El mismo afiliado vigente → con influenced y `renew_on_click`, se corre el vencimiento; si no, solo se anota.
 *  6. Otro afiliado vigente → manda la regla del tipo VIGENTE: keep (no cambia), last (gana el nuevo, como
 *     influyó) o last_if_not_bought (igual, salvo que ya tenga una venta).
 */

export type AffiliateKind = "originated" | "influenced";
export type ReplaceRule = "keep" | "last" | "last_if_not_bought";
export interface AffiliateRef {
  type: "user" | "contact";
  id: string;
}

export interface AffiliateSettings {
  v?: 1;
  originated?: { months?: number | null; replace?: ReplaceRule };
  influenced?: { days?: number; renew_on_click?: boolean; replace?: ReplaceRule };
  counts?: { first_purchase_only?: boolean };
  show_lead_names?: "first_name_initial" | "full" | "hidden";
}

export interface ResolvedAffiliateSettings {
  originatedMonths: number | null;
  originatedReplace: ReplaceRule;
  influencedDays: number;
  renewOnClick: boolean;
  influencedReplace: ReplaceRule;
  firstPurchaseOnly: boolean;
}

/** `{}` = los defaults: lo trajo 12 meses, influyó 90 días con renovación, y la vigente se queda (`keep`). */
export function resolveAffiliateSettings(raw: unknown): ResolvedAffiliateSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as AffiliateSettings;
  const months = s.originated && "months" in s.originated ? s.originated.months ?? null : 12;
  return {
    originatedMonths: months,
    originatedReplace: s.originated?.replace ?? "keep",
    influencedDays: s.influenced?.days ?? 90,
    renewOnClick: s.influenced?.renew_on_click ?? true,
    influencedReplace: s.influenced?.replace ?? "keep",
    firstPurchaseOnly: s.counts?.first_purchase_only === true,
  };
}

export interface AssignInput {
  settings: AffiliateSettings;
  /** El afiliado del código; null si el código no existe. */
  ref: AffiliateRef | null;
  contactId: string;
  touchedAt: string;
  contactCreatedAt: string;
  isFirstTouch: boolean;
  isCustomer: boolean;
  hasSale: boolean;
  now: string;
  current: { affiliate: AffiliateRef; kind: AffiliateKind; assignedAt: string; expiresAt: string | null } | null;
}

export type AssignPlan =
  | { action: "none"; reason: "no_code" | "own_code" | "customer" | "keep" | "bought" }
  | { action: "touch"; reason: "same_affiliate" }
  | { action: "renew"; expiresAt: string }
  | { action: "assign" | "replace"; kind: AffiliateKind; expiresAt: string | null };

const MIN = 60_000;
const DAY = 86_400_000;

/** Suma meses como Postgres (`timestamptz + interval 'N months'`): si el día no existe, el último del mes. */
export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString();
}

const addDaysIso = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY).toISOString();
const sameRef = (a: AffiliateRef, b: AffiliateRef) => a.type === b.type && a.id === b.id;

export function planAffiliateAssignment(i: AssignInput): AssignPlan {
  if (!i.ref) return { action: "none", reason: "no_code" };
  if (i.ref.type === "contact" && i.ref.id === i.contactId) return { action: "none", reason: "own_code" };
  if (i.isCustomer) return { action: "none", reason: "customer" };
  const s = resolveAffiliateSettings(i.settings);
  const kind: AffiliateKind = i.isFirstTouch && Date.parse(i.contactCreatedAt) >= Date.parse(i.touchedAt) - 10 * MIN ? "originated" : "influenced";
  const expiresFor = (k: AffiliateKind, from: string) => (k === "originated" ? (s.originatedMonths === null ? null : addMonthsIso(from, s.originatedMonths)) : addDaysIso(from, s.influencedDays));

  const vigente = i.current && (i.current.expiresAt === null || Date.parse(i.current.expiresAt) >= Date.parse(i.now)) ? i.current : null;
  if (!vigente) return { action: "assign", kind, expiresAt: expiresFor(kind, i.touchedAt) };

  if (sameRef(vigente.affiliate, i.ref)) {
    if (vigente.kind === "influenced" && s.renewOnClick) return { action: "renew", expiresAt: addDaysIso(i.touchedAt, s.influencedDays) };
    return { action: "touch", reason: "same_affiliate" };
  }

  const rule = vigente.kind === "originated" ? s.originatedReplace : s.influencedReplace;
  if (rule === "keep") return { action: "none", reason: "keep" };
  if (rule === "last_if_not_bought" && i.hasSale) return { action: "none", reason: "bought" };
  return { action: "replace", kind: "influenced", expiresAt: addDaysIso(i.touchedAt, s.influencedDays) };
}
