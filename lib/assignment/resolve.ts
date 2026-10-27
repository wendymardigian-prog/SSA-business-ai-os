/**
 * Resolver las asignaciones de un contacto (plano F15). PURA: no toca la base.
 * La usan el job `sales_contact_eval`, el probador y la simulación en seco: así
 * lo que muestra el probador es exactamente lo que el job haría.
 *
 * Reglas de escritura, en orden, para cada `kind`:
 *  1. Con `assignment_locked_at` (alguien asignó a mano), setter y vendedor no se
 *     tocan NUNCA, ni con "puede reasignar".
 *  2. Si el campo ya tiene valor y la regla no puede reasignar → no se toca.
 *  3. Si no, se escribe.
 * Todos los modos arrancan en `manual`: no asignan nada hasta que alguien configure.
 */
import { buildAssignmentContext, type AssignmentContext, type ContactForAssignment, type ContextExtras } from "./context";
import { evaluateConditions } from "./conditions";
import { lastIndexOf, pickRoundRobin } from "./round-robin";
import { ASSIGNMENT_KINDS, type AssignmentKind, type AssignmentRuleRow, type ConditionRule, type Destination } from "./types";

export interface ContactForResolve extends ContactForAssignment {
  setter_id: string | null;
  vendedor_id: string | null;
  referred_by_user_id: string | null;
  referred_by_contact_id: string | null;
  assignment_locked_at: string | null;
}

export interface ResolveExtras extends ContextExtras {
  /** Contactos que existen en el workspace, para validar un destino "contacto". */
  validContactIds?: ReadonlySet<string>;
}

export type SkipReason = "manual" | "locked" | "filled" | "no_match" | "no_destination" | "same";

export interface Candidate {
  /** El id de la regla de la lista (o del `assignment_rules` en el modo reparto). */
  ruleId: string;
  ruleName: string;
  destination: { type: "user" | "contact"; id: string };
  canReassign: boolean;
}

export interface TraceEntry {
  kind: AssignmentKind;
  candidate: Candidate | null;
  outcome: "applied" | SkipReason;
}

export type PointerUpdate =
  | { kind: AssignmentKind; assignmentRuleId: string; scope: "mode"; lastAssignedMemberId: string }
  | { kind: AssignmentKind; assignmentRuleId: string; scope: "rule"; conditionRuleId: string; lastIndex: number };

export interface Resolution {
  setter_id?: string;
  vendedor_id?: string;
  referred_by_user_id?: string;
  referred_by_contact_id?: string;
  applied: Array<{ kind: AssignmentKind; ruleId: string; ruleName: string; destination: { type: "user" | "contact"; id: string } }>;
  skipped: Array<{ kind: AssignmentKind; reason: SkipReason }>;
  pointerUpdates: PointerUpdate[];
  /** Lo que cada kind habría hecho, aplique o no (lo usa el probador). */
  trace: TraceEntry[];
}

/** Una regla sirve si está activa y su destino es válido (una persona del workspace, o un contacto que existe). */
export function matchRule(
  rule: ConditionRule,
  kind: AssignmentKind,
  context: AssignmentContext,
  validTargets: { members: ReadonlySet<string>; contacts: ReadonlySet<string> },
): boolean {
  if (!rule.is_active) return false;
  if (!isDestinationValid(rule.destination, kind, validTargets)) return false;
  return evaluateConditions(rule.conditions, context);
}

/** Un destino inválido se saltea: una persona fuera del workspace, un contacto que no existe, un reparto vacío. */
export function isDestinationValid(
  destination: Destination,
  kind: AssignmentKind,
  validTargets: { members: ReadonlySet<string>; contacts: ReadonlySet<string> },
): boolean {
  if (destination.type === "user") return validTargets.members.has(destination.user_id);
  if (destination.type === "contact") return kind === "referral" && validTargets.contacts.has(destination.contact_id);
  // El referido no se reparte por turnos.
  if (kind === "referral") return false;
  return destination.members.some((m) => validTargets.members.has(m));
}

function currentValue(contact: ContactForResolve, kind: AssignmentKind): string | null {
  if (kind === "setter") return contact.setter_id;
  if (kind === "vendedor") return contact.vendedor_id;
  return contact.referred_by_user_id ?? contact.referred_by_contact_id;
}

export function resolveAssignments(
  contact: ContactForResolve,
  rulesByKind: Partial<Record<AssignmentKind, AssignmentRuleRow>>,
  activeMembers: ReadonlySet<string>,
  extras: ResolveExtras = {},
): Resolution {
  const context = buildAssignmentContext(contact, extras);
  const targets = { members: activeMembers, contacts: extras.validContactIds ?? new Set<string>() };
  const result: Resolution = { applied: [], skipped: [], pointerUpdates: [], trace: [] };

  for (const kind of ASSIGNMENT_KINDS) {
    const rule = rulesByKind[kind];
    const finish = (outcome: TraceEntry["outcome"], candidate: Candidate | null) => {
      result.trace.push({ kind, candidate, outcome });
      if (outcome !== "applied") result.skipped.push({ kind, reason: outcome });
    };

    if (!rule || rule.mode === "manual") {
      finish("manual", null);
      continue;
    }

    // Qué elegiría la regla, sin mirar todavía si se puede escribir.
    let candidate: Candidate | null = null;
    let pointer: PointerUpdate | null = null;

    if (rule.mode === "round_robin") {
      if (kind !== "referral") {
        const pick = pickRoundRobin(rule.enabled_member_ids, lastIndexOf(rule.enabled_member_ids, rule.last_assigned_member_id), activeMembers);
        if (pick) {
          candidate = { ruleId: rule.id, ruleName: `Reparto equitativo (${kind === "setter" ? "setter" : "vendedor"})`, destination: { type: "user", id: pick.memberId }, canReassign: false };
          pointer = { kind, assignmentRuleId: rule.id, scope: "mode", lastAssignedMemberId: pick.memberId };
        }
      }
    } else {
      const ordered = [...rule.condition_rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
      for (const conditionRule of ordered) {
        if (!matchRule(conditionRule, kind, context, targets)) continue;
        const dest = conditionRule.destination;
        if (dest.type === "user") {
          candidate = { ruleId: conditionRule.id, ruleName: conditionRule.name, destination: { type: "user", id: dest.user_id }, canReassign: conditionRule.can_reassign };
        } else if (dest.type === "contact") {
          candidate = { ruleId: conditionRule.id, ruleName: conditionRule.name, destination: { type: "contact", id: dest.contact_id }, canReassign: conditionRule.can_reassign };
        } else {
          const pick = pickRoundRobin(dest.members, dest.last_index ?? -1, activeMembers);
          if (!pick) continue;
          candidate = { ruleId: conditionRule.id, ruleName: conditionRule.name, destination: { type: "user", id: pick.memberId }, canReassign: conditionRule.can_reassign };
          pointer = { kind, assignmentRuleId: rule.id, scope: "rule", conditionRuleId: conditionRule.id, lastIndex: pick.nextIndex };
        }
        break;
      }
    }

    if (!candidate) {
      finish(rule.mode === "round_robin" ? "no_destination" : "no_match", null);
      continue;
    }

    // (1) Lo asignado a mano bloquea lo automático (setter y vendedor).
    if (contact.assignment_locked_at && kind !== "referral") {
      finish("locked", candidate);
      continue;
    }
    // (2) Campo con valor y la regla no puede reasignar.
    const current = currentValue(contact, kind);
    if (current !== null && !candidate.canReassign) {
      finish("filled", candidate);
      continue;
    }
    // Reasignar a quien ya está no es un cambio.
    if (current === candidate.destination.id) {
      finish("same", candidate);
      continue;
    }

    // (3) Se escribe.
    if (kind === "setter") result.setter_id = candidate.destination.id;
    else if (kind === "vendedor") result.vendedor_id = candidate.destination.id;
    else if (candidate.destination.type === "user") result.referred_by_user_id = candidate.destination.id;
    else result.referred_by_contact_id = candidate.destination.id;

    result.applied.push({ kind, ruleId: candidate.ruleId, ruleName: candidate.ruleName, destination: candidate.destination });
    if (pointer) result.pointerUpdates.push(pointer);
    result.trace.push({ kind, candidate, outcome: "applied" });
  }

  return result;
}
