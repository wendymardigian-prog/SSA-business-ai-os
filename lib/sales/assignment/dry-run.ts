/**
 * El probador y la simulación en seco (plano F16). NO escriben: formatean lo que
 * devuelve `resolveAssignments`, la misma función que usa el job, así que el
 * probador muestra exactamente lo que el job haría.
 */
import { resolveAssignments, type ContactForResolve, type ResolveExtras, type SkipReason } from "./resolve";
import { KIND_LABELS, type AssignmentKind, type AssignmentRuleRow } from "./types";

export interface DryRunRow {
  kind: AssignmentKind;
  /** Lo que tiene hoy (id de persona/contacto) o null. */
  current: string | null;
  /** A quién asignaría la regla, aplique o no. */
  wouldAssign: { type: "user" | "contact"; id: string } | null;
  ruleName: string | null;
  /** Si el job lo escribiría. */
  applies: boolean;
  /** Por qué no, en castellano ("no se aplicaría: ya tiene vendedor"). */
  reasonText: string | null;
}

const ARTICLE: Record<AssignmentKind, string> = { setter: "setter", vendedor: "vendedor", referral: "referido" };

export function skipReasonText(kind: AssignmentKind, reason: SkipReason): string {
  switch (reason) {
    case "filled":
      return `no se aplicaría: ya tiene ${ARTICLE[kind]}`;
    case "locked":
      return "no se aplicaría: asignado a mano";
    case "same":
      return `ya tiene a esa persona como ${ARTICLE[kind]}`;
    case "no_match":
      return "ninguna regla coincide";
    case "no_destination":
      return "no hay a quién asignar (nadie activo en el reparto)";
    case "manual":
      return `${KIND_LABELS[kind]} está en modo manual`;
  }
}

function currentOf(contact: ContactForResolve, kind: AssignmentKind): string | null {
  if (kind === "setter") return contact.setter_id;
  if (kind === "vendedor") return contact.vendedor_id;
  return contact.referred_by_user_id ?? contact.referred_by_contact_id;
}

/** Una fila por `kind`: lo que tiene, lo que asignaría la regla y si se aplicaría. */
export function dryRunAssignments(
  contact: ContactForResolve,
  rulesByKind: Partial<Record<AssignmentKind, AssignmentRuleRow>>,
  activeMembers: ReadonlySet<string>,
  extras: ResolveExtras = {},
): DryRunRow[] {
  const resolution = resolveAssignments(contact, rulesByKind, activeMembers, extras);
  return resolution.trace.map((entry) => ({
    kind: entry.kind,
    current: currentOf(contact, entry.kind),
    wouldAssign: entry.candidate?.destination ?? null,
    ruleName: entry.candidate?.ruleName ?? null,
    applies: entry.outcome === "applied",
    reasonText: entry.outcome === "applied" ? null : skipReasonText(entry.kind, entry.outcome),
  }));
}
