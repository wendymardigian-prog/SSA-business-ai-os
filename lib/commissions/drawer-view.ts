/**
 * Lo que la ficha de una comisión decide antes de pintar (F61). Puro: el cajón solo compone esto.
 */
import { formatUsd } from "@/lib/finance/format";
import type { StatusTone } from "@/lib/finance/expense-status";
import { describeRule, type DescribeLookups } from "./describe";
import { commissionRuleFromRow } from "./rule-row";
import type { CommissionStatusKey } from "./status";
import type { CommissionRule } from "./types";

const CHANNEL_LABELS: Record<string, string> = { organic: "Orgánico", paid: "Pagado", referral: "Referido", direct: "Directo" };

export interface DrawerAttribution {
  channelLabel: string | null;
  source: string | null;
  piece: { id: string | null; title: string } | null;
  ad: { id: string | null; name: string } | null;
  /** Medio, campaña, contenido, término y origen del toque (solo con alcance `all`). */
  touch: Array<{ label: string; value: string }>;
  /** `true` = no hay nada de dónde vino (llegó directo o sin datos). */
  empty: boolean;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function attributionView(
  snapshot: Record<string, unknown> | null,
  touch: { medium: string | null; campaign: string | null; content: string | null; term: string | null; origin: string | null } | null,
): DrawerAttribution {
  const channel = text(snapshot?.channel);
  const source = text(snapshot?.source);
  const postId = text(snapshot?.content_post_id);
  const postTitle = text(snapshot?.content_title);
  const adId = text(snapshot?.meta_ad_id);
  const adName = text(snapshot?.ad_name);
  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Medio", value: touch?.medium ?? null },
    { label: "Campaña", value: touch?.campaign ?? null },
    { label: "Contenido", value: touch?.content ?? null },
    { label: "Término", value: touch?.term ?? null },
    { label: "Origen", value: touch?.origin ?? null },
  ];
  const piece = postId || postTitle ? { id: postId, title: postTitle ?? "Una pieza de contenido" } : null;
  const ad = adId || adName ? { id: adId, name: adName ?? "Un anuncio de Meta" } : null;
  return {
    channelLabel: channel ? CHANNEL_LABELS[channel] ?? channel : null,
    source,
    piece,
    ad,
    touch: rows.filter((r): r is { label: string; value: string } => !!r.value),
    empty: !channel && !source && !piece && !ad,
  };
}

/** La foto de la regla (`rule_snapshot`) como una regla tipada. `null` si no hay foto (un ajuste). */
export function ruleFromSnapshot(snapshot: Record<string, unknown> | null): CommissionRule | null {
  if (!snapshot || typeof snapshot.calc_type !== "string") return null;
  return commissionRuleFromRow({ ...snapshot, id: "snapshot" });
}

/** La frase de la regla con la que se calculó. Sin foto, `null`. */
export function usedRuleText(snapshot: Record<string, unknown> | null, lookups: DescribeLookups): string | null {
  const rule = ruleFromSnapshot(snapshot);
  return rule ? describeRule(rule, lookups) : null;
}

/** El chip de la venta cuando ya no está viva («Venta cancelada»). `null` si sigue en pie. */
export function saleClosedChip(saleStatus: string | null | undefined): { label: string; tone: StatusTone } | null {
  switch (saleStatus) {
    case "cancelled":
      return { label: "Venta cancelada", tone: "gray" };
    case "refunded":
      return { label: "Venta reembolsada", tone: "gray" };
    case "subscription_cancelled":
      return { label: "Suscripción cancelada", tone: "gray" };
    default:
      return null;
  }
}

/** Qué acciones permite el estado de la comisión (solo `commissions.manage` las ofrece). */
export function allowedActions(status: CommissionStatusKey, hasExpense: boolean): { assign: boolean; void: boolean } {
  return {
    assign: status === "sin_persona" && !hasExpense,
    void: (status === "pendiente" || status === "retenida" || status === "sin_persona") && !hasExpense,
  };
}

export interface PaymentLine {
  label: string;
  value: string;
}

/**
 * Las líneas de «Pago». El monto cobrado y la comisión del procesador solo llegan con alcance `all`
 * (`null` = no se muestra); el neto es cobrado menos comisión.
 */
export function paymentLines(args: {
  installment: string | null;
  paidOn: string | null;
  methodName: string | null;
  collectedCents: number | null;
  feeCents: number | null;
  formatDate: (date: string | null) => string;
}): PaymentLine[] {
  const lines: PaymentLine[] = [];
  if (args.installment) lines.push({ label: "Pago", value: args.installment });
  lines.push({ label: "Fecha del cobro", value: args.formatDate(args.paidOn) });
  if (args.methodName) lines.push({ label: "Método", value: args.methodName });
  if (args.collectedCents !== null) lines.push({ label: "Cobrado", value: formatUsd(args.collectedCents) });
  if (args.feeCents !== null) lines.push({ label: "Comisión del procesador", value: formatUsd(args.feeCents) });
  if (args.collectedCents !== null && args.feeCents !== null) lines.push({ label: "Neto", value: formatUsd(args.collectedCents - args.feeCents) });
  return lines;
}
