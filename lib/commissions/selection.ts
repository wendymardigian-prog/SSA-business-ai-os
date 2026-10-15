/**
 * Selección en bulk y «Generar gasto» (F60). Puro: la pantalla y la Server Action `generateCommissionPayout`
 * usan estas cuentas; la función SQL `create_commission_payout` las repite (y es la que manda: vuelve a
 * excluir lo que no corresponde con las comisiones bloqueadas).
 *
 * Se puede seleccionar una comisión en estado **Pendiente** (no retenida), con persona, no anulada y sin gasto.
 */
import { monthKey, monthLabel, type CivilDate } from "@/lib/finance/dates";
import { formatUsd } from "@/lib/finance/format";
import { commissionStatus, type CommissionExpenseRef, type CommissionStatusInput } from "./status";

/** Los motivos por los que una comisión no entra a un gasto (los mismos códigos que devuelve la RPC en `excluded`). */
export type NotSelectableCode = "voided" | "no_person" | "already_in_expense" | "held";
export type ExcludedCode = NotSelectableCode | "non_positive_total";

export const EXCLUDED_MESSAGES: Record<ExcludedCode, string> = {
  voided: "Está anulada",
  no_person: "No tiene persona: asignale una primero",
  already_in_expense: "Ya está en un gasto",
  held: "Está retenida: todavía no se puede pagar",
  non_positive_total: "No se genera: el total es 0 o negativo",
};

/** El código por el que NO se puede seleccionar, o null si se puede. Mismo orden que el chip de estado. */
export function selectableReasonCode(c: CommissionStatusInput, expense: CommissionExpenseRef | null | undefined, todayLocal: CivilDate): NotSelectableCode | null {
  switch (commissionStatus(c, expense, todayLocal).key) {
    case "anulada":
      return "voided";
    case "sin_persona":
      return "no_person";
    case "pagada":
    case "en_gasto":
      return "already_in_expense";
    case "retenida":
      return "held";
    default:
      return null;
  }
}

/** El motivo en palabras (para el tooltip de la casilla deshabilitada), o null si se puede seleccionar. */
export function selectableReason(c: CommissionStatusInput, expense: CommissionExpenseRef | null | undefined, todayLocal: CivilDate): string | null {
  const code = selectableReasonCode(c, expense, todayLocal);
  return code ? EXCLUDED_MESSAGES[code] : null;
}

/** Una comisión elegida, con lo que las cuentas necesitan. */
export interface SelectedCommission {
  id: string;
  /** Null = sin persona (no se puede seleccionar, pero no rompe las cuentas). */
  userId: string | null;
  /** Céntimos; puede ser negativo (un ajuste que resta). */
  amountCents: number;
  /** Fecha del cobro `AAAA-MM-DD`. */
  paidOn: CivilDate | null;
}

const cents = (n: number): number => Math.round(Number(n) || 0);

export interface SelectionTotals {
  count: number;
  cents: number;
  people: number;
}

export function selectionTotals(selected: readonly SelectedCommission[]): SelectionTotals {
  return {
    count: selected.length,
    cents: selected.reduce((sum, c) => sum + cents(c.amountCents), 0),
    people: new Set(selected.map((c) => c.userId).filter((u): u is string => !!u)).size,
  };
}

/** «14 comisiones · USD 1.240,00 · 2 personas». */
export function summarizeSelection(selected: readonly SelectedCommission[]): string {
  const t = selectionTotals(selected);
  return `${t.count} ${t.count === 1 ? "comisión" : "comisiones"} · ${formatUsd(t.cents)} · ${t.people} ${t.people === 1 ? "persona" : "personas"}`;
}

export interface PersonGroup {
  userId: string;
  commissions: SelectedCommission[];
  count: number;
  totalCents: number;
}

/** Las comisiones elegidas agrupadas por persona, en el orden en que aparece cada una. Las sin persona se dejan afuera. */
export function groupByPerson(selected: readonly SelectedCommission[]): PersonGroup[] {
  const groups = new Map<string, PersonGroup>();
  for (const c of selected) {
    if (!c.userId) continue;
    let g = groups.get(c.userId);
    if (!g) {
      g = { userId: c.userId, commissions: [], count: 0, totalCents: 0 };
      groups.set(c.userId, g);
    }
    g.commissions.push(c);
    g.count += 1;
    g.totalCents += cents(c.amountCents);
  }
  return [...groups.values()];
}

/** Un gasto se genera solo si el total es positivo (0 o negativo no se paga). */
export function isPayable(totalCents: number): boolean {
  return cents(totalCents) > 0;
}

export type PayoutMode = "per_person" | "single";

export interface PayoutGroup {
  /** Null en el modo «un solo gasto». */
  userId: string | null;
  commissionIds: string[];
  count: number;
  totalCents: number;
  payable: boolean;
  /** `non_positive_total` si no se genera. */
  reason: "non_positive_total" | null;
}

/** Lo que mostraría el modal y lo que haría la RPC: un grupo por persona, o todo junto. */
export function planPayout(selected: readonly SelectedCommission[], mode: PayoutMode): PayoutGroup[] {
  const make = (userId: string | null, list: readonly SelectedCommission[]): PayoutGroup => {
    const totalCents = list.reduce((sum, c) => sum + cents(c.amountCents), 0);
    const payable = isPayable(totalCents);
    return { userId, commissionIds: list.map((c) => c.id), count: list.length, totalCents, payable, reason: payable ? null : "non_positive_total" };
  };
  if (mode === "single") return selected.length ? [make(null, selected)] : [];
  return groupByPerson(selected).map((g) => make(g.userId, g.commissions));
}

const SHORT_MONTH = (key: string): string => monthLabel(key).split(" ")[0].slice(0, 3);

/**
 * El concepto propuesto del gasto. El mes es el del cobro más reciente; si abarca varios meses, el rango
 * (`sep–oct 2026`).
 *   «Comisiones de Ana · octubre 2026»   «Comisiones de Ana · sep–oct 2026»   «Comisiones del equipo · octubre 2026»
 */
export function payoutConcept(person: string | { name: string } | null | undefined, commissions: ReadonlyArray<{ paidOn: CivilDate | null }>): string {
  const name = (typeof person === "string" ? person : person?.name ?? "").trim();
  const head = name ? `Comisiones de ${name}` : "Comisiones del equipo";
  const months = [...new Set(commissions.map((c) => c.paidOn).filter((d): d is CivilDate => !!d).map(monthKey))].sort();
  if (!months.length) return head;
  const first = months[0];
  const last = months[months.length - 1];
  if (first === last) return `${head} · ${monthLabel(last)}`;
  const [y1] = first.split("-");
  const [y2] = last.split("-");
  return y1 === y2 ? `${head} · ${SHORT_MONTH(first)}–${SHORT_MONTH(last)} ${y2}` : `${head} · ${SHORT_MONTH(first)} ${y1}–${SHORT_MONTH(last)} ${y2}`;
}
